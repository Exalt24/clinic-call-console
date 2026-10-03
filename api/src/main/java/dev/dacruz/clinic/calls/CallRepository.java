package dev.dacruz.clinic.calls;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface CallRepository extends JpaRepository<CallRecord, UUID>, JpaSpecificationExecutor<CallRecord> {
}
