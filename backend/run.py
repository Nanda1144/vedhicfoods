import os
from app import create_app
from config import DevelopmentConfig

app = create_app(config_class=DevelopmentConfig)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)