from app import create_app
from config import ProductionConfig, config_by_name
import os

env = os.getenv("FLASK_ENV", "production").lower()
config_class = config_by_name.get(env, ProductionConfig)

app = create_app(config_class=config_class)

if __name__ == "__main__":
    app.run()
