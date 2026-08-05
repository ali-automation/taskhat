package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// S3 stores blobs in any S3-compatible bucket (AWS, Hetzner, MinIO, …).
type S3 struct {
	client *minio.Client
	bucket string
	prefix string
}

type S3Config struct {
	EndpointURL string // e.g. https://fsn1.your-objectstorage.com
	Region      string
	Bucket      string
	AccessKey   string
	SecretKey   string
	Prefix      string // key prefix inside the bucket, e.g. "attachments/"
}

func NewS3(ctx context.Context, cfg S3Config) (*S3, error) {
	u, err := url.Parse(cfg.EndpointURL)
	if err != nil {
		return nil, fmt.Errorf("s3 endpoint: %w", err)
	}
	client, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https",
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 client: %w", err)
	}
	s := &S3{client: client, bucket: cfg.Bucket, prefix: cfg.Prefix}
	// Fail fast on bad credentials/bucket at startup.
	if _, err := client.BucketExists(ctx, cfg.Bucket); err != nil {
		return nil, fmt.Errorf("s3 bucket check (%s): %w", cfg.Bucket, err)
	}
	return s, nil
}

func (s *S3) key(key string) string { return s.prefix + strings.TrimPrefix(key, "/") }

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, s.key(key), r, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("s3 put: %w", err)
	}
	return nil
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, s.key(key), minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("s3 get: %w", err)
	}
	// GetObject is lazy; probe so missing keys surface as ErrNotFound here.
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		var respErr minio.ErrorResponse
		if errors.As(err, &respErr) && respErr.Code == "NoSuchKey" {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("s3 stat: %w", err)
	}
	return obj, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, s.key(key), minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("s3 delete: %w", err)
	}
	return nil
}
