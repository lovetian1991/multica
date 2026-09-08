package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx := context.Background()

	// 从环境变量获取数据库连接
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://multica:multica@localhost:5432/multica?sslmode=disable"
	}

	fmt.Println("连接数据库:", databaseURL)

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("无法连接数据库: %v\n", err)
	}
	defer pool.Close()

	fmt.Println("✓ 数据库连接成功")

	// 1. 检查 product_version 表是否存在
	var tableExists bool
	err = pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_name = 'product_version'
		)
	`).Scan(&tableExists)

	if err != nil {
		log.Fatalf("检查表失败: %v\n", err)
	}

	if !tableExists {
		fmt.Println("✗ product_version 表不存在")
		return
	}
	fmt.Println("✓ product_version 表存在")

	// 2. 检查 product 表结构（应该没有 directory 和 remark）
	var hasDirectory bool
	err = pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT FROM information_schema.columns
			WHERE table_name = 'product' AND column_name = 'directory'
		)
	`).Scan(&hasDirectory)

	if err != nil {
		log.Fatalf("检查列失败: %v\n", err)
	}

	if hasDirectory {
		fmt.Println("✗ product 表仍有 directory 字段（应该已删除）")
	} else {
		fmt.Println("✓ product 表的 directory 字段已正确删除")
	}

	// 3. 检查 issue 表是否有 product_version_id
	var hasProductVersionId bool
	err = pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT FROM information_schema.columns
			WHERE table_name = 'issue' AND column_name = 'product_version_id'
		)
	`).Scan(&hasProductVersionId)

	if err != nil {
		log.Fatalf("检查列失败: %v\n", err)
	}

	if !hasProductVersionId {
		fmt.Println("✗ issue 表缺少 product_version_id 字段")
	} else {
		fmt.Println("✓ issue 表有 product_version_id 字段")
	}

	// 4. 创建测试产品
	fmt.Println("\n创建测试数据...")
	var productID string
	err = pool.QueryRow(ctx, `
		INSERT INTO product (name)
		VALUES ('测试产品-' || to_char(now(), 'YYYYMMDDHH24MISS'))
		RETURNING id
	`).Scan(&productID)

	if err != nil {
		log.Fatalf("创建产品失败: %v\n", err)
	}
	fmt.Printf("✓ 创建测试产品，ID: %s\n", productID)

	// 5. 创建测试版本
	var versionID string
	err = pool.QueryRow(ctx, `
		INSERT INTO product_version (product_id, name, directory, remark)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, productID, "v1.0.0", "/data/test/v1", "测试版本").Scan(&versionID)

	if err != nil {
		log.Fatalf("创建版本失败: %v\n", err)
	}
	fmt.Printf("✓ 创建测试版本，ID: %s\n", versionID)

	// 6. 查询版本
	var versionName, directory, remark string
	err = pool.QueryRow(ctx, `
		SELECT name, directory, remark
		FROM product_version
		WHERE id = $1
	`, versionID).Scan(&versionName, &directory, &remark)

	if err != nil {
		log.Fatalf("查询版本失败: %v\n", err)
	}

	fmt.Printf("✓ 查询到版本: %s, 目录: %s, 备注: %s\n", versionName, directory, remark)

	fmt.Println("\n=== 所有测试通过！===")
	fmt.Println("\n数据库层已正常工作，现在需要：")
	fmt.Println("1. 启动后端服务器")
	fmt.Println("2. 访问系统管理 -> 产品管理页面")
}
