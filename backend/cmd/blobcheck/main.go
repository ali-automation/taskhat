// Command blobcheck reports whether an object exists in the configured S3
// bucket. Exit 0 = exists, 1 = missing, 2 = error. Test tooling only.
package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: blobcheck <key>")
		os.Exit(2)
	}
	endpoint := os.Getenv("S3_ENDPOINT_URL")
	u, err := url.Parse(endpoint)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad endpoint:", err)
		os.Exit(2)
	}
	client, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY_ID"), os.Getenv("S3_SECRET_ACCESS_KEY"), ""),
		Secure: u.Scheme == "https",
		Region: os.Getenv("S3_REGION"),
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	key := os.Getenv("S3_PREFIX")
	if key == "" {
		key = "attachments/"
	}
	key += strings.TrimPrefix(os.Args[1], "/")
	_, err = client.StatObject(context.Background(), os.Getenv("S3_BUCKET"), key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			fmt.Println("missing", key)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	fmt.Println("exists", key)
}
