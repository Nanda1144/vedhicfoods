import sys
import os

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from app import create_app
from app.extensions import db, bcrypt
from app.models.user import User
from app.models.category import Category
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.coupon import Coupon
from app.models.banner import Banner
from app.models.cart import Cart
from app.utils.helpers import slugify

app = create_app()

CATEGORIES = [
    {
        "name": "Millet Laddus",
        "slug": "millet-laddus",
        "description": "Stone-ground millets roasted in small batches and bound with jaggery and cold-pressed ghee. No refined sugar, no preservatives.",
        "image_url": "https://images.unsplash.com/photo-1599785209707-a456fc1337bb?auto=format&fit=crop&w=600&q=80",
    },
    {
        "name": "Ragi Specials",
        "slug": "ragi-specials",
        "description": "Finger millet from rain-fed Karnataka farms — high in calcium and iron, milled fresh and crafted into traditional favourites.",
        "image_url": "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=600&q=80",
    },
    {
        "name": "Traditional Rotis",
        "slug": "traditional-rotis",
        "description": "Hand-pressed rotis made the way they have been for generations — ragi, jowar, bajra and multigrain, with zero maida.",
        "image_url": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=600&q=80",
    },
    {
        "name": "Organic Millets",
        "slug": "organic-millets",
        "description": "Foxtail, kodo, barnyard, little and proso millet — cleaned, de-stoned and packed within days of milling.",
        "image_url": "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80",
    },
    {
        "name": "Heritage Grains",
        "slug": "heritage-grains",
        "description": "Indigenous rice varieties and ancient grains nurtured for flavor, nutrition, and soil regeneration.",
        "image_url": "https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?auto=format&fit=crop&w=600&q=80",
    },
]

PRODUCTS = [
    {
        "category_slug": "millet-laddus",
        "name": "Foxtail Millet Laddu",
        "slug": "foxtail-millet-laddu-250g",
        "description": "Nutrient-dense foxtail millet flour roasted with A2 Gir cow ghee and sweet organic palm jaggery.",
        "price": 280.0,
        "discount_percentage": 10.0,
        "stock_quantity": 45,
        "unit": "250 g",
        "sku": "LAD-FOX-250",
        "is_featured": True,
        "image": "https://images.unsplash.com/photo-1599785209707-a456fc1337bb?auto=format&fit=crop&w=600&q=80",
    },
    {
        "category_slug": "ragi-specials",
        "name": "Sprouted Ragi Malt",
        "slug": "sprouted-ragi-malt-500g",
        "description": "Traditional baby and family wellness health mix made from whole sprouted finger millets, dry fruits, and cardamom.",
        "price": 320.0,
        "discount_percentage": 5.0,
        "stock_quantity": 60,
        "unit": "500 g",
        "sku": "RAG-MLT-500",
        "is_featured": True,
        "image": "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=600&q=80",
    },
    {
        "category_slug": "traditional-rotis",
        "name": "Ready-to-Cook Jowar Roti",
        "slug": "ready-to-cook-jowar-roti-pack-5",
        "description": "Vacuum-packed griddle-ready sorghum rotis made strictly with pure water and sea salt. Zero gluten additives.",
        "price": 140.0,
        "discount_percentage": 0.0,
        "stock_quantity": 25,
        "unit": "Pack of 5",
        "sku": "ROT-JOW-05",
        "is_featured": False,
        "image": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=600&q=80",
    },
    {
        "category_slug": "organic-millets",
        "name": "Unpolished Kodo Millet",
        "slug": "unpolished-kodo-millet-1kg",
        "description": "Single-origin unpolished Kodo millet rich in natural polyphenols, dietary fibre, and essential micronutrients.",
        "price": 190.0,
        "discount_percentage": 15.0,
        "stock_quantity": 100,
        "unit": "1 kg",
        "sku": "MIL-KOD-1K",
        "is_featured": True,
        "image": "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=600&q=80",
    },
    {
        "category_slug": "heritage-grains",
        "name": "Navara Red Rice",
        "slug": "navara-red-rice-1kg",
        "description": "Renowned Ayurvedic medicinal grain revered for immunity rejuvenation and gentle digestion.",
        "price": 240.0,
        "discount_percentage": 8.0,
        "stock_quantity": 40,
        "unit": "1 kg",
        "sku": "RIC-NAV-1K",
        "is_featured": True,
        "image": "https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?auto=format&fit=crop&w=600&q=80",
    },
]

COUPONS = [
    {
        "code": "VEDHIC10",
        "description": "10% off on your entire organic order",
        "discount_type": "PERCENTAGE",
        "discount_value": 10.0,
        "minimum_order_amount": 299.0,
        "maximum_discount": 100.0,
        "per_user_limit": 5,
    },
    {
        "code": "WELCOME50",
        "description": "Flat ₹50 off on orders above ₹499",
        "discount_type": "FIXED",
        "discount_value": 50.0,
        "minimum_order_amount": 499.0,
        "maximum_discount": 50.0,
        "per_user_limit": 1,
    },
]

BANNERS = [
    {
        "title": "Pure Farm-Fresh Millets & Laddus",
        "description": "Handcrafted with stone-ground heritage grains, A2 ghee, and native jaggery.",
        "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1400&q=80",
        "link_url": "/shop",
        "display_order": 1,
        "is_active": True,
    }
]


def seed():
    with app.app_context():
        print("[*] Seeding Vedhic Foods database...")

        # 1. Seed Admin User
        admin_email = "admin@vedhicfoods.com"
        admin = User.query.filter_by(email=admin_email).first()
        if not admin:
            pw_hash = bcrypt.generate_password_hash("Admin@Vedhic2026").decode("utf-8")
            admin = User(
                full_name="Vedhic Administrator",
                email=admin_email,
                phone="+919876543210",
                password_hash=pw_hash,
                role="ADMIN",
                is_active=True,
                is_verified=True,
            )
            db.session.add(admin)
            db.session.flush()
            cart = Cart(user_id=admin.id)
            db.session.add(cart)
            print(f"  + Created Admin: {admin_email} (Password: Admin@Vedhic2026)")
        else:
            print(f"  - Admin {admin_email} already exists")

        # 2. Seed Customer User
        cust_email = "customer@vedhicfoods.com"
        customer = User.query.filter_by(email=cust_email).first()
        if not customer:
            pw_hash = bcrypt.generate_password_hash("Customer@123").decode("utf-8")
            customer = User(
                full_name="Ananya Sharma",
                email=cust_email,
                phone="+919876500000",
                password_hash=pw_hash,
                role="USER",
                is_active=True,
                is_verified=True,
            )
            db.session.add(customer)
            db.session.flush()
            cart = Cart(user_id=customer.id)
            db.session.add(cart)
            print(f"  + Created Demo Customer: {cust_email} (Password: Customer@123)")

        # 3. Seed Categories
        category_map = {}
        for cat_data in CATEGORIES:
            cat = Category.query.filter_by(slug=cat_data["slug"]).first()
            if not cat:
                cat = Category(
                    name=cat_data["name"],
                    slug=cat_data["slug"],
                    description=cat_data["description"],
                    image_url=cat_data["image_url"],
                    is_active=True,
                )
                db.session.add(cat)
                db.session.flush()
                print(f"  + Created Category: {cat.name}")
            category_map[cat.slug] = cat.id

        # 4. Seed Products
        for prod_data in PRODUCTS:
            prod = Product.query.filter_by(slug=prod_data["slug"]).first()
            cat_id = category_map.get(prod_data["category_slug"])
            if not prod and cat_id:
                p = float(prod_data["price"])
                d = float(prod_data["discount_percentage"])
                final_p = round(p * (1.0 - (d / 100.0)), 2)

                prod = Product(
                    category_id=cat_id,
                    name=prod_data["name"],
                    slug=prod_data["slug"],
                    description=prod_data["description"],
                    price=p,
                    discount_percentage=d,
                    final_price=final_p,
                    stock_quantity=prod_data["stock_quantity"],
                    unit=prod_data["unit"],
                    sku=prod_data["sku"],
                    is_active=True,
                    is_featured=prod_data["is_featured"],
                )
                db.session.add(prod)
                db.session.flush()

                if prod_data.get("image"):
                    img = ProductImage(
                        product_id=prod.id,
                        image_url=prod_data["image"],
                        display_order=0,
                    )
                    db.session.add(img)

                print(f"  + Created Product: {prod.name} (Rs.{prod.final_price})")

        # 5. Seed Coupons
        for coupon_data in COUPONS:
            coupon = Coupon.query.filter_by(code=coupon_data["code"]).first()
            if not coupon:
                coupon = Coupon(
                    code=coupon_data["code"],
                    description=coupon_data["description"],
                    discount_type=coupon_data["discount_type"],
                    discount_value=coupon_data["discount_value"],
                    minimum_order_amount=coupon_data["minimum_order_amount"],
                    maximum_discount=coupon_data["maximum_discount"],
                    per_user_limit=coupon_data["per_user_limit"],
                    is_active=True,
                )
                db.session.add(coupon)
                print(f"  + Created Coupon: {coupon.code}")

        # 6. Seed Banners
        for banner_data in BANNERS:
            banner = Banner.query.filter_by(title=banner_data["title"]).first()
            if not banner:
                banner = Banner(
                    title=banner_data["title"],
                    description=banner_data["description"],
                    image_url=banner_data["image_url"],
                    link_url=banner_data["link_url"],
                    display_order=banner_data["display_order"],
                    is_active=banner_data["is_active"],
                )
                db.session.add(banner)
                print(f"  + Created Banner: {banner.title}")

        db.session.commit()
        print("[SUCCESS] Database seeding complete!")


if __name__ == "__main__":
    seed()
