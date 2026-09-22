"""全局配置：从 .env 读取（前缀无关，字段名即变量名）。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "同兴高科项目管理系统"
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk"
    test_database_url: str = "postgresql+psycopg://txgk:txgk@127.0.0.1:35432/txgk_test"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720

    upload_dir: str = "../data/uploads"  # 相对后端工作目录（backend/），即仓库根 data/uploads
    cors_origins: str = "http://127.0.0.1:5207,http://localhost:5207"

    @property
    def cors_origin_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


settings = Settings()
