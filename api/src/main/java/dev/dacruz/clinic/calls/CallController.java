package dev.dacruz.clinic.calls;

import dev.dacruz.clinic.calls.CallDtos.CallDetail;
import dev.dacruz.clinic.calls.CallDtos.CallSummary;
import dev.dacruz.clinic.calls.CallDtos.RevealRequest;
import dev.dacruz.clinic.calls.CallDtos.RevealResponse;
import dev.dacruz.clinic.calls.CallDtos.StatusRequest;
import dev.dacruz.clinic.security.Principals;
import jakarta.validation.Valid;
import java.util.UUID;
import dev.dacruz.clinic.web.PageDto;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/calls")
public class CallController {

    private final CallService service;

    public CallController(CallService service) {
        this.service = service;
    }

    @GetMapping
    public PageDto<CallSummary> list(@RequestParam(required = false) CallRecord.Status status,
                                     @RequestParam(required = false) String q,
                                     @RequestParam(defaultValue = "0") int page,
                                     @RequestParam(defaultValue = "12") int size) {
        return PageDto.of(service.page(status, q, page, size));
    }

    @GetMapping("/{id}")
    public ResponseEntity<CallDetail> detail(@PathVariable UUID id, Authentication auth) {
        return noStore(service.detail(id, Principals.name(auth), Principals.role(auth)));
    }

    @PatchMapping("/{id}/status")
    public CallSummary status(@PathVariable UUID id, @Valid @RequestBody StatusRequest body, Authentication auth) {
        return service.changeStatus(id, body.status(), Principals.name(auth), Principals.role(auth));
    }

    /** ADMIN only, enforced here and again by a test that proves a REVIEWER gets 403. */
    @PostMapping("/{id}/reveal")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<RevealResponse> reveal(@PathVariable UUID id, @Valid @RequestBody RevealRequest body,
                                                 Authentication auth) {
        return noStore(service.reveal(id, body.reason(), Principals.name(auth), Principals.role(auth)));
    }

    /** PHI responses must never be cached by a browser, a proxy or a CDN. */
    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
