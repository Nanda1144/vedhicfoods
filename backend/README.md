# Vedhic Foods - Production Backend API

A production-ready REST API backend for **Vedhic Foods**, an Indian food and agriculture e-commerce marketplace. Built with Python 3.12+, Flask, SQLAlchemy, PostgreSQL, Flask-JWT-Extended, Marshmallow, and designed from day one for cloud deployment on AWS (EC2, RDS, S3) with Razorpay payment processing.

---

## 1. Architecture Overview

```
                      [ React + Vite Frontend (CloudFront / Vercel) ]
                                            │
                                     HTTPS (REST API)
                                            ▼
                               [ AWS EC2 / Nginx Reverse Proxy ]
                                            │
                                  Gunicorn (WSGI Server)
                                            │
                                  Flask Application
                     ┌──────────────────────┼──────────────────────┐
                     ▼                      ▼                      ▼
           [ AWS RDS PostgreSQL ]     [ AWS S3 Bucket ]     [ Razorpay Gateway ]
           - Users, Orders, Stock    - Product Images      - Order Initiation
           - Coupons, Cart, Reviews  - Banners             - Webhook & Signature Verification
```

### Modular Backend Structure
```
backend/
├── app/
│   ├── __init__.py          # Flask application factory (create_app), extensions, blueprints
│   ├── extensions.py        # SQLAlchemy, Migrate, JWT, Bcrypt, CORS, Swagger
│   ├── models/              # 15 PostgreSQL models with UTC timestamps, constraints, cascades
│   ├── routes/              # Modular blueprints (/api/auth, /api/products, /api/cart, etc.)
│   ├── schemas/             # Marshmallow validation and serialization schemas
│   ├── services/            # Business logic: Auth, Products, Cart, Orders, Coupons, S3, Payments
│   ├── middleware/          # Role-based authorization (@admin_required) and centralized error handling
│   └── utils/               # Standardized response format, pagination, validators, order numbers
├── migrations/              # Alembic database migration revisions
├── tests/                   # 21 comprehensive pytest unit & integration tests
├── .env.example             # Safe environment variables template
├── config.py                # Development, Testing, and Production configurations
├── run.py                   # Development entrypoint
├── wsgi.py                  # Production Gunicorn entrypoint
├── seed_db.py               # Initial category, product, and admin database seeding script
├── requirements.txt         # Pinned production dependencies
└── README.md
```

---

## 2. Technology Stack

* **Language**: Python 3.12+ (tested on Python 3.13)
* **Framework**: Flask 3.1+
* **Database & ORM**: PostgreSQL via SQLAlchemy 2.0+ and Flask-SQLAlchemy
* **Migrations**: Flask-Migrate / Alembic
* **Authentication**: Flask-JWT-Extended (JSON Web Tokens)
* **Password Hashing**: Flask-Bcrypt
* **Validation & Serialization**: Marshmallow
* **Cross-Origin Resource Sharing**: Flask-CORS
* **Cloud Storage**: AWS S3 via Boto3 (with local fallback for offline development)
* **Payment Gateway**: Razorpay SDK (HMAC SHA-256 signature verification)
* **API Documentation**: Flasgger (OpenAPI 3.0 / Swagger UI)
* **WSGI Server**: Gunicorn
* **Testing**: Pytest

---

## 3. Getting Started Locally

### Prerequisites
* Python 3.12 or newer
* PostgreSQL 14+ installed and running
* Git

### Step 1: Virtual Environment Setup
```bash
cd "C:\Projects\Vedhic Foods\backend"

# Create virtual environment
python -m venv venv

# Activate on Windows PowerShell:
.\venv\Scripts\Activate.ps1

# Activate on Linux / macOS:
source venv/bin/activate
```

### Step 2: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
copy .env.example .env   # Windows
# or: cp .env.example .env  # Linux/macOS
```

Edit `.env` with your database credentials:
```env
FLASK_ENV=development
SECRET_KEY=generate-a-strong-random-32-character-secret-key
JWT_SECRET_KEY=generate-a-strong-random-32-character-jwt-key
DATABASE_URL=postgresql://username:password@localhost:5432/vedhicfoods
TEST_DATABASE_URL=postgresql://username:password@localhost:5432/vedhicfoods_test
FRONTEND_URL=http://localhost:5173

# AWS S3 (optional for local development - uses local upload fallback when unset)
AWS_REGION=ap-south-1
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Razorpay (optional for local development - uses simulation when unset)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

### Step 4: Run Database Migrations
```bash
# Initialize migration directory (already configured in repository)
# flask db init

# Generate migration revision
flask db migrate -m "initial schema"

# Apply migrations to database
flask db upgrade
```

### Step 5: Seed Sample Data
Populate the database with initial categories, products, coupons, and demo accounts:
```bash
python seed_db.py
```
This generates:
* **Admin Account**: `admin@vedhicfoods.com` (Password: `Admin@Vedhic2026`)
* **Customer Account**: `customer@vedhicfoods.com` (Password: `Customer@123`)
* **Categories**: Millet Laddus, Ragi Specials, Traditional Rotis, Organic Millets, Heritage Grains
* **Products**: Foxtail Millet Laddu, Sprouted Ragi Malt, Kodo Millet, etc.
* **Coupons**: `VEDHIC10` (10% off), `WELCOME50` (Flat ₹50 off)

### Step 6: Start Development Server
```bash
python run.py
```
The server will start on `http://127.0.0.1:5000`.

---

## 4. API Endpoints & Swagger Documentation

Once the server is running, open the interactive Swagger UI in your browser:
👉 **[http://localhost:5000/api/docs/](http://localhost:5000/api/docs/)**

### Authentication (`/api/auth`)
* `POST /api/auth/register`: Register new customer with password complexity check
* `POST /api/auth/login`: Authenticate and receive JWT access token
* `GET /api/auth/me`: Get authenticated user profile (`Bearer <token>`)
* `POST /api/auth/logout`: Invalidate/clear client session

### Categories (`/api/categories`)
* `GET /api/categories`: Public active category list
* `GET /api/categories/<id_or_slug>`: Retrieve category by ID or slug

### Products (`/api/products`)
* `GET /api/products`: Filterable product catalog (search, category, price range, sorting, pagination)
* `GET /api/products/<id_or_slug>`: Detailed product view with images and live pricing

### Shopping Cart (`/api/cart`)
* `GET /api/cart`: Current user's cart with live DB price recalculations
* `POST /api/cart/items`: Add item to cart with stock validation
* `PUT /api/cart/items/<id>`: Update item quantity
* `DELETE /api/cart/items/<id>`: Remove item from cart
* `DELETE /api/cart`: Clear cart

### Addresses (`/api/addresses`)
* `GET /api/addresses`: List saved addresses for authenticated user
* `POST /api/addresses`: Add new delivery address
* `PUT /api/addresses/<id>`: Update delivery address
* `DELETE /api/addresses/<id>`: Remove address
* `POST /api/addresses/<id>/default`: Set address as primary default

### Coupons (`/api/coupons`)
* `GET /api/coupons`: Active public promotional coupons
* `POST /api/coupons/validate`: Server-side coupon verification against spend and user limits

### Orders (`/api/orders`)
* `POST /api/orders`: Atomic checkout with row-level stock locking and inventory decrement
* `GET /api/orders`: Order history for logged-in user
* `GET /api/orders/<id>`: Order details
* `POST /api/orders/<id>/cancel`: Cancel order and automatically restore product inventory

### Payments (`/api/payments`)
* `POST /api/payments/create-order`: Initiate Razorpay payment order
* `POST /api/payments/verify`: HMAC-SHA256 signature verification with idempotent completion
* `GET /api/payments/<id>`: Payment status and receipt

### Wishlist (`/api/wishlist`)
* `GET /api/wishlist`: User's saved favorite products
* `POST /api/wishlist/<product_id>`: Add to wishlist
* `DELETE /api/wishlist/<product_id>`: Remove from wishlist

### Notifications (`/api/notifications`)
* `GET /api/notifications`: In-app customer updates
* `PUT /api/notifications/<id>/read`: Mark notification as read
* `PUT /api/notifications/read-all`: Mark all as read

### Admin Portal (`/api/admin`)
Requires `ADMIN` role in JWT token:
* `GET /api/admin/dashboard`: Metrics (users, orders, revenue, low-stock items)
* `POST / PUT / DELETE /api/admin/categories`: Category management
* `POST / PUT / DELETE /api/admin/products`: Product management
* `POST /api/admin/products/<id>/images`: Multipart image upload (AWS S3)
* `POST / PUT / DELETE /api/admin/coupons`: Coupon management
* `GET / PUT /api/admin/orders`: Customer order tracking and status transitions
* `POST / PUT / DELETE /api/admin/banners`: Promotional hero banner management

---

## 5. Automated Testing

Run the full pytest suite:
```bash
venv\Scripts\python.exe -m pytest -v
```

The test suite executes 21 integration tests covering:
1. `test_health.py`: Root and health check endpoints
2. `test_auth.py`: Registration, duplicate emails, password validation, login, profile, logout
3. `test_categories.py`: Category creation, public listing, slug lookups, admin protection
4. `test_products.py`: Server-side final pricing calculations, search, filters, pagination
5. `test_cart.py`: Add to cart, out-of-stock validation, quantity updates, removal, clearing
6. `test_addresses.py`: Address book CRUD, default address promotion
7. `test_coupons.py`: Percentage discounts, minimum order threshold, maximum discount caps
8. `test_orders.py`: Atomic checkout, row-level locking, stock reduction, order cancellation and inventory restoration
9. `test_payments.py`: Razorpay order creation, HMAC signature verification, idempotency
10. `test_authorization.py`: Multi-tenant isolation (user A cannot see or mutate user B's cart, orders, addresses, or wishlist), and non-admin rejection (403) from admin endpoints.

---

## 6. AWS Production Deployment Guide

### Target AWS Architecture
* **Frontend**: React + TypeScript hosted on AWS CloudFront / Vercel
* **API Gateway**: Nginx on AWS EC2 (Ubuntu 24.04 LTS) in Region `ap-south-1` (Mumbai)
* **Application**: Gunicorn running Flask application factory (`wsgi:app`)
* **Database**: AWS RDS PostgreSQL (Multi-AZ for high availability)
* **Media & Assets**: AWS S3 Bucket (`vedhicfoods-assets`)
* **Logging & Monitoring**: AWS CloudWatch Logs & Metrics

### 1. AWS RDS PostgreSQL Setup
1. Create an AWS RDS PostgreSQL instance in region `ap-south-1`:
   - Engine: PostgreSQL 16 or 18
   - DB identifier: `vedhicfoods-db`
   - Master username: `vedhicadmin`
   - Master password: `<secure-password>`
   - Virtual Private Cloud (VPC): Default or custom VPC
   - Public access: No (accessible only within VPC or from EC2 security group)
2. Obtain the endpoint: `vedhicfoods-db.c12345.ap-south-1.rds.amazonaws.com`
3. Configure `DATABASE_URL` in EC2 environment:
   ```
   DATABASE_URL=postgresql://vedhicadmin:<password>@vedhicfoods-db.c12345.ap-south-1.rds.amazonaws.com:5432/vedhicfoods
   ```

### 2. AWS S3 Bucket Configuration
1. Create an S3 bucket in `ap-south-1`: `vedhicfoods-assets`.
2. Disable "Block all public access" for the bucket if serving directly or attach a CloudFront distribution.
3. Configure CORS policy for the S3 bucket to allow `https://vedhicfoods.com`:
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
       "AllowedOrigins": ["https://vedhicfoods.com"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```
4. Attach an IAM Role with `AmazonS3FullAccess` to your EC2 instance (eliminating the need to store AWS keys on the server).

### 3. AWS EC2 Setup (Ubuntu)
1. Launch an EC2 `t3.medium` or `t3.small` instance running Ubuntu 24.04 in `ap-south-1`.
2. Configure Security Group:
   - Inbound: Port 22 (SSH from your IP), Port 80 (HTTP), Port 443 (HTTPS)
3. SSH into the instance:
   ```bash
   ssh -i "your-key.pem" ubuntu@<ec2-ip>
   ```
4. Install system packages:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y python3-pip python3-venv git nginx libpq-dev
   ```
5. Clone repository and install dependencies:
   ```bash
   git clone <repo-url> /var/www/vedhicfoods-backend
   cd /var/www/vedhicfoods-backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
6. Set production environment variables in `/var/www/vedhicfoods-backend/.env`:
   ```env
   FLASK_ENV=production
   SECRET_KEY=<generate-with-python-secrets.token_hex(32)>
   JWT_SECRET_KEY=<generate-with-python-secrets.token_hex(32)>
   DATABASE_URL=postgresql://vedhicadmin:<password>@<rds-endpoint>:5432/vedhicfoods
   AWS_REGION=ap-south-1
   AWS_S3_BUCKET=vedhicfoods-assets
   FRONTEND_URL=https://vedhicfoods.com
   RAZORPAY_KEY_ID=<your-live-razorpay-key>
   RAZORPAY_KEY_SECRET=<your-live-razorpay-secret>
   ```
7. Apply migrations to RDS:
   ```bash
   flask db upgrade
   python seed_db.py
   ```

### 4. Systemd Service for Gunicorn
Create `/etc/systemd/system/vedhicfoods.service`:
```ini
[Unit]
Description=Gunicorn instance for Vedhic Foods Backend
After=network.target

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/var/www/vedhicfoods-backend
Environment="PATH=/var/www/vedhicfoods-backend/venv/bin"
ExecStart=/var/www/vedhicfoods-backend/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5000 wsgi:app --access-logfile /var/log/vedhicfoods-access.log --error-logfile /var/log/vedhicfoods-error.log

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl start vedhicfoods
sudo systemctl enable vedhicfoods
sudo systemctl status vedhicfoods
```

### 5. Nginx Reverse Proxy & SSL (HTTPS)
Configure `/etc/nginx/sites-available/vedhicfoods`:
```nginx
server {
    server_name api.vedhicfoods.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and test configuration:
```bash
sudo ln -s /etc/nginx/sites-available/vedhicfoods /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Obtain free SSL certificate via Let's Encrypt:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.vedhicfoods.com
```

---

## 7. Production Operations & Security Checklist

* **Password Security**: Passwords hashed with Bcrypt (cost factor 12). Plaintext passwords never stored.
* **Server-side Pricing**: Prices, totals, discounts, and tax calculated exclusively on backend. Frontend prices ignored.
* **Inventory Protection**: Row-level database locks (`with_for_update`) prevent race conditions and negative stock.
* **Idempotent Payments**: Payment callbacks deduplicated to prevent multiple orders or double charging.
* **CORS**: Restricted in production to configured `FRONTEND_URL`.
* **Zero Secrets in Git**: `.env` is ignored in `.gitignore`. Secrets handled via AWS Secrets Manager or EC2 environment.
* **Centralized Error Handling**: Safe generic error messages returned in production; technical stack traces suppressed.

---

## 8. License

Copyright © 2026 Vedhic Foods. All rights reserved.
