package com.alanya.repository;

import com.alanya.model.CallHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface CallHistoryRepository extends JpaRepository<CallHistory, Long> {
    List<CallHistory> findByCallerIdOrReceiverIdOrderByCreatedAtDesc(Integer userId1, Integer userId2);
}
