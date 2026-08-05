// Package storage abstracts attachment blob storage: an S3-compatible bucket
// in real deployments, the local filesystem as a dev fallback.
package storage

import (
	"context"
	"errors"
	"io"
)

var ErrNotFound = errors.New("blob not found")

type Blob interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// FromConfig picks the backend: S3 when configured, filesystem otherwise.
func FromConfig(ctx context.Context, s3Endpoint, s3Region, s3Bucket, s3AccessKey, s3SecretKey, s3Prefix, fsDir string) (Blob, error) {
	if s3Endpoint != "" {
		return NewS3(ctx, S3Config{
			EndpointURL: s3Endpoint,
			Region:      s3Region,
			Bucket:      s3Bucket,
			AccessKey:   s3AccessKey,
			SecretKey:   s3SecretKey,
			Prefix:      s3Prefix,
		})
	}
	return NewFS(fsDir)
}
