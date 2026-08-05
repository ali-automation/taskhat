package config

import (
	"fmt"
	"os"
)

type Config struct {
	DBURL      string
	RedisURL   string
	AMQPURL    string
	JWTSecret  string
	BaseURL    string
	ListenAddr string
	Env        string
	StorageDir string // attachment files (filesystem fallback)
	SMTPAddr     string // e.g. mailhog:1025; empty disables email
	SMTPFrom     string
	SMTPUsername string // empty = unauthenticated relay
	SMTPPassword string

	// S3-compatible object storage; S3EndpointURL set = S3 backend enabled.
	S3EndpointURL string
	S3Region      string
	S3Bucket      string
	S3AccessKey   string
	S3SecretKey   string
	S3Prefix      string

	// Public-demo mode: instant read-only guest login on the login page.
	DemoMode       bool
	DemoContactURL string // shown in the demo banner ("connect for full access")
	DemoInstagramURL string // optional second contact link in the demo banner
}

func Load() (Config, error) {
	c := Config{
		DBURL:      os.Getenv("TASKHAT_DB_URL"),
		RedisURL:   os.Getenv("TASKHAT_REDIS_URL"),
		AMQPURL:    os.Getenv("TASKHAT_AMQP_URL"),
		JWTSecret:  os.Getenv("TASKHAT_JWT_SECRET"),
		BaseURL:    getenv("TASKHAT_BASE_URL", "http://localhost:8080"),
		ListenAddr: getenv("TASKHAT_LISTEN_ADDR", ":8081"),
		Env:        getenv("TASKHAT_ENV", "dev"),
		StorageDir: getenv("TASKHAT_STORAGE_DIR", "/data/attachments"),
		SMTPAddr:     os.Getenv("TASKHAT_SMTP_ADDR"),
		SMTPFrom:     getenv("TASKHAT_SMTP_FROM", "taskhat@localhost"),
		SMTPUsername: os.Getenv("TASKHAT_SMTP_USERNAME"),
		SMTPPassword: os.Getenv("TASKHAT_SMTP_PASSWORD"),

		S3EndpointURL: os.Getenv("S3_ENDPOINT_URL"),
		S3Region:      os.Getenv("S3_REGION"),
		S3Bucket:      os.Getenv("S3_BUCKET"),
		S3AccessKey:   os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey:   os.Getenv("S3_SECRET_ACCESS_KEY"),
		S3Prefix:      getenv("S3_PREFIX", "attachments/"),

		DemoMode:       os.Getenv("TASKHAT_DEMO_MODE") == "true" || os.Getenv("TASKHAT_DEMO_MODE") == "1",
		DemoContactURL: os.Getenv("TASKHAT_DEMO_CONTACT_URL"),
		DemoInstagramURL: os.Getenv("TASKHAT_DEMO_INSTAGRAM_URL"),
	}
	for name, v := range map[string]string{
		"TASKHAT_DB_URL":     c.DBURL,
		"TASKHAT_REDIS_URL":  c.RedisURL,
		"TASKHAT_AMQP_URL":   c.AMQPURL,
		"TASKHAT_JWT_SECRET": c.JWTSecret,
	} {
		if v == "" {
			return Config{}, fmt.Errorf("missing required env var %s", name)
		}
	}
	if len(c.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("TASKHAT_JWT_SECRET must be at least 32 bytes")
	}
	return c, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
