export interface Product {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProductVersion {
  id: string;
  product_id: string;
  name: string;
  directory: string;
  remark: string;
  folder_id?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProductRequest {
  name: string;
}

export interface UpdateProductRequest {
  name: string;
}

export interface CreateProductVersionRequest {
  name: string;
  directory?: string;
  remark?: string;
  folder_id?: string;
  enabled?: boolean;
}

export interface UpdateProductVersionRequest {
  name: string;
  directory?: string;
  remark?: string;
  folder_id?: string;
  enabled?: boolean;
}

export interface ListProductsResponse {
  products: Product[];
  total: number;
}

export interface ListProductVersionsResponse {
  versions: ProductVersion[];
  total: number;
}
