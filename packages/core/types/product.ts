export interface Product {
  id: string;
  name: string;
  directory: string;
  remark: string;
  created_at: string;
  updated_at: string;
}

export interface CreateProductRequest {
  name: string;
  directory?: string;
  remark?: string;
}

export interface UpdateProductRequest {
  name: string;
  directory?: string;
  remark?: string;
}

export interface ListProductsResponse {
  products: Product[];
  total: number;
}
