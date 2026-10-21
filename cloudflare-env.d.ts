declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PHONE_LOGIN_ENABLED?: string;
    AUTH_PEPPER?: string;
    TENCENT_SMS_SECRET_ID?: string;
    TENCENT_SMS_SECRET_KEY?: string;
    TENCENT_SMS_APP_ID?: string;
    TENCENT_SMS_SIGN_NAME?: string;
    TENCENT_SMS_TEMPLATE_ID?: string;
    TENCENT_SMS_REGION?: string;
    SMS_DAILY_LIMIT?: string;
  }
}
