/**
 * Provider-agnostic email contract.
 *
 * This lived inside `brevo.service.ts`, which made "provider-agnostic" a
 * misnomer: every new transport had to import its shape from the Brevo file.
 * It now sits here, in the directory that already existed for exactly this
 * purpose, so `ses.service.ts` and any future provider depend on the contract
 * rather than on each other.
 */

export interface SendTransactionalEmailOptions {
  to: string | string[]
  subject: string
  htmlContent: string
  textContent?: string
  fromEmail?: string
  fromName?: string
  /** Provider-specific reply-to, when it differs from the sender. */
  replyTo?: string
}

export interface SendAttachmentEmailOptions {
  toEmail: string
  toName: string
  subject: string
  htmlContent: string
  attachment: {
    name: string
    /** Base64-encoded content, as required by both Brevo and SES. */
    content: string
  }
}

/** A transactional email transport. */
export interface EmailProvider {
  readonly name: string
  /** True when the provider has everything it needs to send. */
  isConfigured(): boolean
  /**
   * True when the transport must not reach the provider.
   *
   * Unconditional under NODE_ENV=test, so a populated `.env` cannot make the
   * suite send real mail, exhaust the SES daily quota, or become dependent on
   * sender verification.
   */
  shouldSimulate(): boolean
  /** Sends and returns the provider message id. Throws on failure. */
  sendTransactionalEmail(options: SendTransactionalEmailOptions): Promise<string>
  /** Sends with an attachment. Returns true on success and throws classified failures. */
  sendAttachmentEmail(options: SendAttachmentEmailOptions): Promise<boolean>
}
