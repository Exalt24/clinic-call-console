package dev.dacruz.clinic.web;

import java.util.List;
import org.springframework.data.domain.Page;

/**
 * The page shape the Angular client depends on, owned by this API. Serialising Spring's PageImpl directly is not a stable
 * contract (the framework warns about it), so a rename inside Spring Data would silently break the frontend.
 */
public record PageDto<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    public static <T> PageDto<T> of(Page<T> p) {
        return new PageDto<>(p.getContent(), p.getNumber(), p.getSize(), p.getTotalElements(), p.getTotalPages());
    }
}
