package com.alanya.repository;

import com.alanya.model.MessageRead;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

@Repository
public interface MessageReadRepository extends JpaRepository<MessageRead, Long> {
    boolean existsByMessageIdAndUserId(Long messageId, Integer userId);
    long countByMessageIdAndUserIdIn(Long messageId, Collection<Integer> userIds);
    List<MessageRead> findByMessageIdInAndUserId(Collection<Long> messageIds, Integer userId);
}
