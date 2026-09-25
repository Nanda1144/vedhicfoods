from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import db
from app.models.address import Address
from app.schemas.address import AddressCreateSchema, AddressUpdateSchema
from app.utils.response import success_response, error_response

addresses_bp = Blueprint("addresses", __name__, url_prefix="/api/addresses")

create_addr_schema = AddressCreateSchema()
update_addr_schema = AddressUpdateSchema()


@addresses_bp.get("")
@jwt_required()
def list_addresses():
    """List all saved addresses for current user."""
    user_id = int(get_jwt_identity())
    addresses = Address.query.filter_by(user_id=user_id).order_by(Address.is_default.desc(), Address.created_at.desc()).all()
    return success_response(data=[a.to_dict() for a in addresses], message="Addresses retrieved")


@addresses_bp.post("")
@jwt_required()
def create_address():
    """Create a new address for current user."""
    user_id = int(get_jwt_identity())
    data = create_addr_schema.load(request.get_json() or {})

    # If first address or marked default, manage default flags
    existing_count = Address.query.filter_by(user_id=user_id).count()
    is_default = data.get("is_default", False) or (existing_count == 0)

    if is_default:
        Address.query.filter_by(user_id=user_id).update({"is_default": False})

    address = Address(
        user_id=user_id,
        full_name=data["full_name"].strip(),
        phone=data["phone"].strip(),
        address_line_1=data["address_line_1"].strip(),
        address_line_2=data.get("address_line_2", "").strip() if data.get("address_line_2") else None,
        city=data["city"].strip(),
        state=data["state"].strip(),
        pincode=data["pincode"].strip(),
        latitude=data.get("latitude"),
        longitude=data.get("longitude"),
        is_default=is_default,
    )
    db.session.add(address)
    db.session.commit()

    return success_response(data=address.to_dict(), message="Address created successfully", status_code=201)


@addresses_bp.put("/<int:address_id>")
@jwt_required()
def update_address(address_id: int):
    """Update an existing address (ownership strictly checked)."""
    user_id = int(get_jwt_identity())
    address = Address.query.filter_by(id=address_id, user_id=user_id).first()
    if not address:
        return error_response(message="Address not found or access denied", status_code=404)

    data = update_addr_schema.load(request.get_json() or {})

    if data.get("is_default"):
        Address.query.filter_by(user_id=user_id).update({"is_default": False})
        address.is_default = True

    for field in ["full_name", "phone", "address_line_1", "address_line_2", "city", "state", "pincode", "latitude", "longitude"]:
        if field in data and data[field] is not None:
            setattr(address, field, data[field])

    db.session.commit()
    return success_response(data=address.to_dict(), message="Address updated successfully")


@addresses_bp.delete("/<int:address_id>")
@jwt_required()
def delete_address(address_id: int):
    """Delete an address (ownership strictly checked)."""
    user_id = int(get_jwt_identity())
    address = Address.query.filter_by(id=address_id, user_id=user_id).first()
    if not address:
        return error_response(message="Address not found or access denied", status_code=404)

    was_default = address.is_default
    db.session.delete(address)
    db.session.flush()

    # If deleted address was default, promote another address to default if exists
    if was_default:
        next_addr = Address.query.filter_by(user_id=user_id).first()
        if next_addr:
            next_addr.is_default = True

    db.session.commit()
    return success_response(message="Address deleted successfully")


@addresses_bp.post("/<int:address_id>/default")
@jwt_required()
def set_default_address(address_id: int):
    """Set an address as the default address."""
    user_id = int(get_jwt_identity())
    address = Address.query.filter_by(id=address_id, user_id=user_id).first()
    if not address:
        return error_response(message="Address not found or access denied", status_code=404)

    Address.query.filter_by(user_id=user_id).update({"is_default": False})
    address.is_default = True
    db.session.commit()

    return success_response(data=address.to_dict(), message="Default address updated")
