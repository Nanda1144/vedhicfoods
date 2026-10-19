import './_safety'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/config/database'

/**
 * Live PostgreSQL contract checks for the generated Prisma model. This suite
 * compares every mapped model/field/relation/index/enum with pg_catalog and
 * exercises rollback and concurrent writes using a uniquely named setting row.
 * It only runs under the integration-test disposable-database guard.
 */
const models = Prisma.dmmf.datamodel.models
const enums = Prisma.dmmf.datamodel.enums
const schemaSource = readFileSync(resolve(process.cwd(), '../database/prisma/schema.prisma'), 'utf8')

const disposableKey = `__db_contract_${Date.now()}_${Math.random().toString(36).slice(2)}`
const postgresTypes: Record<string, string[]> = {
  String: ['text', 'varchar', 'bpchar'],
  Boolean: ['bool'],
  Int: ['int4'],
  BigInt: ['int8'],
  Float: ['float4', 'float8'],
  Decimal: ['numeric'],
  DateTime: ['timestamp', 'timestamptz'],
  Json: ['json', 'jsonb'],
  Bytes: ['bytea'],
}

describe('Prisma ↔ PostgreSQL schema contract', () => {
  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: disposableKey } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: disposableKey } })
  })

  afterEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: disposableKey } })
  })

  it('has every Prisma model table and scalar field with matching nullability', async () => {
    const rows = await prisma.$queryRaw<Array<{
      table_name: string
      column_name: string
      is_nullable: string
      udt_name: string
    }>>`
      SELECT table_name, column_name, is_nullable, udt_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `
    const columns = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]))

    for (const model of models) {
      const table = model.dbName ?? model.name
      for (const field of model.fields.filter((candidate) => candidate.kind !== 'object')) {
        const dbColumn = field.dbName ?? field.name
        const actual = columns.get(`${table}.${dbColumn}`)
        expect(actual, `missing PostgreSQL column ${table}.${dbColumn}`).toBeDefined()
        expect(actual!.is_nullable === 'YES', `${table}.${dbColumn} nullability`).toBe(!field.isRequired)
        if (field.kind === 'scalar' && postgresTypes[field.type]) {
          const expectedTypes = field.isList ? postgresTypes[field.type].map((type) => `_${type}`) : postgresTypes[field.type]
          expect(expectedTypes, `${table}.${dbColumn} PostgreSQL type`).toContain(actual!.udt_name)
        } else if (field.kind === 'enum') {
          expect(actual!.udt_name, `${table}.${dbColumn} enum type`).toBe(field.type)
        }
      }
    }
  })

  it('contains every declared enum and all declared enum values', async () => {
    const rows = await prisma.$queryRaw<Array<{ enum_name: string; enum_value: string }>>`
      SELECT t.typname AS enum_name, e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = current_schema()
      ORDER BY t.typname, e.enumsortorder
    `
    const actual = new Map<string, Set<string>>()
    for (const row of rows) {
      const values = actual.get(row.enum_name) ?? new Set<string>()
      values.add(row.enum_value)
      actual.set(row.enum_name, values)
    }

    for (const definition of enums) {
      const values = actual.get(definition.name)
      expect(values, `missing PostgreSQL enum ${definition.name}`).toBeDefined()
      for (const value of definition.values) {
        expect(values!.has(value.name), `${definition.name}.${value.name}`).toBe(true)
      }
    }
  })

  it('has a PostgreSQL foreign key for every Prisma relation field', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; columns: string[]; delete_action: string }>>`
      SELECT child.relname AS table_name,
             array_agg(child_col.attname ORDER BY key.ord) AS columns,
             fk.confdeltype::text AS delete_action
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid = fk.conrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
      JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS key(attnum, ord) ON true
      JOIN pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = key.attnum
      WHERE fk.contype = 'f' AND ns.nspname = current_schema()
      GROUP BY child.relname, fk.oid
    `
    const actual = new Map(rows.map((row) => [`${row.table_name}:${row.columns.join(',')}`, row.delete_action]))
    const deleteActions: Record<string, string> = { Cascade: 'c', SetNull: 'n', Restrict: 'r', NoAction: 'a', SetDefault: 'd' }

    for (const model of models) {
      const table = model.dbName ?? model.name
      const modelBlock = schemaSource.match(new RegExp(`(?:^|\\n)model\\s+${model.name}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))?.[1]
      expect(modelBlock, `missing source model ${model.name}`).toBeDefined()
      for (const field of model.fields.filter((candidate) => candidate.kind === 'object' && candidate.relationFromFields?.length)) {
        const columns = (field.relationFromFields ?? []).map((sourceField) => {
          const scalar = model.fields.find((candidate) => candidate.name === sourceField)
          return scalar?.dbName ?? sourceField
        })
        const key = `${table}:${columns.join(',')}`
        expect(actual.has(key), `missing foreign key on ${table}(${columns.join(',')})`).toBe(true)
        const relationDeclaration = modelBlock!.split(/\r?\n/).find((line) => new RegExp(`^\\s*${field.name}\\s`).test(line))
        const declaredDelete = relationDeclaration?.match(/onDelete:\s*(\w+)/)?.[1]
        if (declaredDelete && deleteActions[declaredDelete]) {
          expect(actual.get(key), `${table}(${columns.join(',')}) onDelete`).toBe(deleteActions[declaredDelete])
        }
      }
    }
  })

  it('has PostgreSQL indexes for every declared unique/index field set', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; columns: string[] }>>`
      SELECT tab.relname AS table_name,
             array_agg(att.attname ORDER BY keys.ordinality) AS columns
      FROM pg_index idx
      JOIN pg_class tab ON tab.oid = idx.indrelid
      JOIN pg_namespace ns ON ns.oid = tab.relnamespace
      JOIN LATERAL unnest(idx.indkey) WITH ORDINALITY AS keys(attnum, ordinality) ON true
      JOIN pg_attribute att ON att.attrelid = tab.oid AND att.attnum = keys.attnum
      WHERE ns.nspname = current_schema() AND keys.ordinality <= idx.indnkeyatts
      GROUP BY tab.relname, idx.indexrelid
    `
    const actual = new Set(rows.map((row) => `${row.table_name}:${row.columns.join(',')}`))

    for (const model of models) {
      const table = model.dbName ?? model.name
      const expected = new Set<string>()
      for (const field of model.fields) {
        if (field.isUnique || field.isId) expected.add(field.dbName ?? field.name)
      }
      if (model.primaryKey?.fields.length) {
        expected.add(model.primaryKey.fields.map((name) => model.fields.find((field) => field.name === name)?.dbName ?? name).join(','))
      }
      for (const fields of model.uniqueFields) {
        expected.add(fields.map((name) => model.fields.find((field) => field.name === name)?.dbName ?? name).join(','))
      }
      for (const index of model.uniqueIndexes) {
        expected.add(index.fields.map((name) => model.fields.find((field) => field.name === name)?.dbName ?? name).join(','))
      }

      // Prisma's runtime DMMF omits ordinary @@index declarations. Read those
      // declarations from the checked-in source schema and map field names via
      // DMMF so the database check still covers every declared index.
      const modelBlock = schemaSource.match(new RegExp(`(?:^|\\n)model\\s+${model.name}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))?.[1]
      expect(modelBlock, `missing source model ${model.name}`).toBeDefined()
      const mapFieldToColumn = (name: string) => {
        const field = model.fields.find((candidate) => candidate.name === name)
        if (field?.dbName) return field.dbName
        const declaration = modelBlock!.split(/\r?\n/).find((line) => new RegExp(`^\\s*${name}\\s`).test(line))
        return declaration?.match(/@map\("([^"]+)"\)/)?.[1] ?? name
      }
      for (const line of modelBlock!.split(/\r?\n/)) {
        if (!/^\s*@@(?:index|unique|id)\s*\(/.test(line)) continue
        const fieldList = line.match(/\[([^\]]+)\]/)?.[1]
        if (!fieldList) continue
        const names = fieldList.split(',').map((part) => part.trim().match(/^(\w+)/)?.[1]).filter((name): name is string => Boolean(name))
        expected.add(names.map(mapFieldToColumn).join(','))
      }
      for (const columns of expected) {
        expect(actual.has(`${table}:${columns}`), `missing index ${table}(${columns})`).toBe(true)
      }
    }
  })

  it('uses database defaults and updates rows transactionally', async () => {
    await prisma.systemSetting.create({ data: { key: disposableKey, value: '0' } })
    const created = await prisma.systemSetting.findUniqueOrThrow({ where: { key: disposableKey } })
    expect(created.category).toBe('GENERAL')
    expect(created.isPublic).toBe(false)

    await expect(prisma.$transaction(async (tx) => {
      await tx.systemSetting.update({ where: { key: disposableKey }, data: { value: 'rolled-back' } })
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: disposableKey } })).value).toBe('0')

    await prisma.systemSetting.update({ where: { key: disposableKey }, data: { value: '1' } })
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: disposableKey } })).value).toBe('1')
  })

  it('serializes concurrent atomic updates without losing writes', async () => {
    await prisma.systemSetting.create({ data: { key: disposableKey, value: '0' } })
    await Promise.all(Array.from({ length: 12 }, () => prisma.$executeRaw`
      UPDATE system_settings SET value = (value::integer + 1)::text WHERE key = ${disposableKey}
    `))
    const row = await prisma.systemSetting.findUniqueOrThrow({ where: { key: disposableKey } })
    expect(row.value).toBe('12')
  })

  it('rejects duplicate keys and missing foreign-key targets', async () => {
    await prisma.systemSetting.create({ data: { key: disposableKey, value: 'first' } })
    await expect(prisma.systemSetting.create({ data: { key: disposableKey, value: 'duplicate' } })).rejects.toMatchObject({
      code: 'P2002',
    })
    await expect(prisma.inventory.create({ data: { productId: `missing-${disposableKey}` } })).rejects.toMatchObject({
      code: 'P2003',
    })
  })
})

