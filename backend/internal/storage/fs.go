package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// FS stores blobs as files under a directory (dev fallback).
type FS struct {
	dir string
}

func NewFS(dir string) (*FS, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("storage dir: %w", err)
	}
	return &FS{dir: dir}, nil
}

func (f *FS) path(key string) string { return filepath.Join(f.dir, filepath.Base(key)) }

func (f *FS) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	dst, err := os.Create(f.path(key))
	if err != nil {
		return fmt.Errorf("create blob: %w", err)
	}
	if _, err := io.Copy(dst, r); err != nil {
		dst.Close()
		os.Remove(f.path(key))
		return fmt.Errorf("write blob: %w", err)
	}
	return dst.Close()
}

func (f *FS) Get(_ context.Context, key string) (io.ReadCloser, error) {
	file, err := os.Open(f.path(key))
	if os.IsNotExist(err) {
		return nil, ErrNotFound
	}
	return file, err
}

func (f *FS) Delete(_ context.Context, key string) error {
	err := os.Remove(f.path(key))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
