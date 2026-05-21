package com.alanya.repository;

import com.alanya.model.ConversationMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ConversationMemberRepository extends JpaRepository<ConversationMember, Long> {
    List<ConversationMember> findByConversationId(Long conversationId);
    List<ConversationMember> findByUserId(Integer userId);
    boolean existsByConversationIdAndUserId(Long conversationId, Integer userId);
}
