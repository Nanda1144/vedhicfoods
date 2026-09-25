import os
import uuid
import logging
from typing import Dict, Any, Optional
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename
from flask import current_app
from app.utils.validators import validate_uploaded_image

logger = logging.getLogger(__name__)


class S3Service:
    """Service abstraction for AWS S3 image storage with local fallback for development."""

    @staticmethod
    def upload_image(file: FileStorage, folder: str = "products") -> Dict[str, Any]:
        """
        Uploads an image to AWS S3 (or local filesystem if S3 is not configured).
        Validates extension, MIME type, and size.
        """
        valid, msg = validate_uploaded_image(file)
        if not valid:
            raise ValueError(msg)

        original_filename = secure_filename(file.filename or "image.jpg")
        ext = original_filename.rsplit(".", 1)[1].lower()
        unique_key = f"uploads/{folder}/{uuid.uuid4().hex}.{ext}"

        bucket = current_app.config.get("AWS_S3_BUCKET")
        region = current_app.config.get("AWS_REGION", "ap-south-1")
        access_key = current_app.config.get("AWS_ACCESS_KEY_ID")
        secret_key = current_app.config.get("AWS_SECRET_ACCESS_KEY")

        # If AWS S3 credentials and bucket are configured, upload to S3
        if bucket and (access_key or os.getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")):
            try:
                import boto3
                from botocore.exceptions import BotoCoreError, ClientError

                client_kwargs = {"region_name": region}
                if access_key and secret_key:
                    client_kwargs["aws_access_key_id"] = access_key
                    client_kwargs["aws_secret_access_key"] = secret_key

                s3_client = boto3.client("s3", **client_kwargs)
                s3_client.upload_fileobj(
                    file.stream,
                    bucket,
                    unique_key,
                    ExtraArgs={"ContentType": file.mimetype},
                )
                image_url = f"https://{bucket}.s3.{region}.amazonaws.com/{unique_key}"
                logger.info(f"Image uploaded to S3: {image_url}")
                return {"image_url": image_url, "s3_key": unique_key}
            except (BotoCoreError, ClientError) as e:
                logger.error(f"S3 upload failed: {str(e)}", exc_info=True)
                raise RuntimeError(f"Failed to upload image to S3: {str(e)}")

        # Fallback to local uploads directory (for local dev/offline testing)
        local_base = current_app.config.get("UPLOAD_FOLDER", os.path.join(os.getcwd(), "uploads"))
        local_dir = os.path.join(local_base, folder)
        os.makedirs(local_dir, exist_ok=True)
        local_filename = f"{uuid.uuid4().hex}.{ext}"
        local_filepath = os.path.join(local_dir, local_filename)

        file.seek(0)
        file.save(local_filepath)
        local_url = f"/uploads/{folder}/{local_filename}"
        logger.info(f"Image saved locally (dev mode): {local_filepath}")
        return {"image_url": local_url, "s3_key": f"local/{folder}/{local_filename}"}

    @staticmethod
    def delete_image(s3_key: str) -> bool:
        """Delete an image from S3 or local storage."""
        if not s3_key:
            return False

        bucket = current_app.config.get("AWS_S3_BUCKET")
        region = current_app.config.get("AWS_REGION", "ap-south-1")
        access_key = current_app.config.get("AWS_ACCESS_KEY_ID")
        secret_key = current_app.config.get("AWS_SECRET_ACCESS_KEY")

        if bucket and not s3_key.startswith("local/"):
            try:
                import boto3
                client_kwargs = {"region_name": region}
                if access_key and secret_key:
                    client_kwargs["aws_access_key_id"] = access_key
                    client_kwargs["aws_secret_access_key"] = secret_key
                s3_client = boto3.client("s3", **client_kwargs)
                s3_client.delete_object(Bucket=bucket, Key=s3_key)
                return True
            except Exception as e:
                logger.warning(f"Failed to delete S3 object {s3_key}: {e}")
                return False

        # Local delete
        if s3_key.startswith("local/"):
            rel_path = s3_key.replace("local/", "", 1)
            local_base = current_app.config.get("UPLOAD_FOLDER", os.path.join(os.getcwd(), "uploads"))
            full_path = os.path.join(local_base, rel_path)
            if os.path.exists(full_path):
                try:
                    os.remove(full_path)
                    return True
                except Exception as e:
                    logger.warning(f"Failed to delete local file {full_path}: {e}")
        return False
