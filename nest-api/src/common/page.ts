/** The page shape the Angular client depends on, owned by this API (the same fields as the Spring Boot API's PageDto). */
export interface PageDto<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export function pageOf<T>(content: T[], page: number, size: number, totalElements: number): PageDto<T> {
  return { content, page, size, totalElements, totalPages: Math.ceil(totalElements / size) };
}
