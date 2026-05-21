package com.alanya.repository;

import com.alanya.model.Conversation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ConversationRepository extends JpaRepository<Conversation, Long> {

    /**
     * Liste toutes les conversations dont l'utilisateur est membre,
     * triees par date du dernier message (plus recent en premier).
     */
    @Query("SELECT c FROM Conversation c " +
           "WHERE c.id IN (" +
           "  SELECT cm.conversationId FROM ConversationMember cm WHERE cm.userId = :userId" +
           ") " +
           "ORDER BY c.lastMessageAt DESC")
    List<Conversation> findAllByUserId(@Param("userId") Integer userId);
}
