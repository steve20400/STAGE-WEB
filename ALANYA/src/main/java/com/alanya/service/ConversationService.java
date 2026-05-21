package com.alanya.service;

import com.alanya.dto.request.CreateChatRequest;
import com.alanya.dto.response.ConversationResponse;
import com.alanya.model.Conversation;
import com.alanya.model.ConversationMember;
import com.alanya.model.User;
import com.alanya.repository.ConversationMemberRepository;
import com.alanya.repository.ConversationRepository;
import com.alanya.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ConversationService {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    @Autowired
    private ConversationRepository conversationRepository;

    @Autowired
    private ConversationMemberRepository memberRepository;

    @Autowired
    private UserRepository userRepository;

    /** GET /chats — toutes les conversations dont l'user est membre. */
    public List<ConversationResponse> listConversations(Integer userId) {
        return conversationRepository.findAllByUserId(userId).stream()
                .map(c -> toResponse(c, userId))
                .collect(Collectors.toList());
    }

    /**
     * POST /chats — cree une conversation privee OU un groupe.
     * Si une conversation 1-to-1 existe deja entre les 2 users, on la renvoie.
     */
    @Transactional
    public ConversationResponse createConversation(Integer currentUserId, CreateChatRequest request) {
        boolean isGroup = request.getMemberIds() != null && !request.getMemberIds().isEmpty();
        if (!isGroup && (request.getContactId() == null || request.getContactId().isBlank())) {
            throw new RuntimeException("Fournir contactId (prive) ou name + memberIds (groupe).");
        }
        return isGroup
                ? createGroup(currentUserId, request)
                : createPrivate(currentUserId, parseId(request.getContactId(), "contactId"));
    }

    /* ----- Cas prive (1-to-1) ----- */

    private ConversationResponse createPrivate(Integer currentUserId, Integer contactId) {
        if (contactId.equals(currentUserId)) {
            throw new RuntimeException("Impossible de creer une conversation avec soi-meme.");
        }
        userRepository.findById(contactId)
                .orElseThrow(() -> new RuntimeException("Contact introuvable."));

        // Conversation deja existante ?
        Optional<Conversation> existing = findExistingPrivateConversation(currentUserId, contactId);
        if (existing.isPresent()) {
            return toResponse(existing.get(), currentUserId);
        }

        Conversation conv = new Conversation();
        conv.setIsGroup(false);
        conv.setCreatedAt(LocalDateTime.now());
        conv = conversationRepository.save(conv);

        addMember(conv.getId(), currentUserId);
        addMember(conv.getId(), contactId);

        return toResponse(conv, currentUserId);
    }

    private Optional<Conversation> findExistingPrivateConversation(Integer userA, Integer userB) {
        // On parcourt les conversations du user A et on garde celles dont l'autre membre est B
        return conversationRepository.findAllByUserId(userA).stream()
                .filter(c -> Boolean.FALSE.equals(c.getIsGroup()))
                .filter(c -> {
                    List<ConversationMember> members = memberRepository.findByConversationId(c.getId());
                    return members.size() == 2 &&
                            members.stream().anyMatch(m -> m.getUserId().equals(userB));
                })
                .findFirst();
    }

    /* ----- Cas groupe ----- */

    private ConversationResponse createGroup(Integer currentUserId, CreateChatRequest request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new RuntimeException("Le nom du groupe est obligatoire.");
        }
        Conversation conv = new Conversation();
        conv.setIsGroup(true);
        conv.setGroupName(request.getName().trim());
        conv.setCreatedAt(LocalDateTime.now());
        conv = conversationRepository.save(conv);

        Set<Integer> uniqueIds = new HashSet<>();
        uniqueIds.add(currentUserId);
        for (String idStr : request.getMemberIds()) {
            Integer id = parseId(idStr, "memberId");
            if (userRepository.existsById(id)) {
                uniqueIds.add(id);
            }
        }
        for (Integer id : uniqueIds) {
            addMember(conv.getId(), id);
        }

        return toResponse(conv, currentUserId);
    }

    /* ----- Helpers ----- */

    private void addMember(Long conversationId, Integer userId) {
        ConversationMember m = new ConversationMember();
        m.setConversationId(conversationId);
        m.setUserId(userId);
        m.setJoinedAt(LocalDateTime.now());
        memberRepository.save(m);
    }

    private ConversationResponse toResponse(Conversation conv, Integer currentUserId) {
        List<ConversationMember> members = memberRepository.findByConversationId(conv.getId());

        String displayName;
        String initials;
        boolean online = false;
        List<String> memberIds;

        if (Boolean.TRUE.equals(conv.getIsGroup())) {
            displayName = conv.getGroupName() != null ? conv.getGroupName() : "Groupe";
            initials = computeInitials(displayName);
            memberIds = members.stream()
                    .map(m -> String.valueOf(m.getUserId()))
                    .collect(Collectors.toList());
        } else {
            // Conversation 1-to-1 : afficher l'autre user
            User other = members.stream()
                    .map(ConversationMember::getUserId)
                    .filter(id -> !id.equals(currentUserId))
                    .findFirst()
                    .flatMap(userRepository::findById)
                    .orElse(null);
            if (other != null) {
                displayName = other.getName();
                initials = computeInitials(displayName);
                online = Boolean.TRUE.equals(other.getIsOnline());
            } else {
                displayName = "Inconnu";
                initials = "??";
            }
            memberIds = Collections.emptyList();
        }

        String time = conv.getLastMessageAt() != null
                ? conv.getLastMessageAt().format(TIME_FMT)
                : "";
        int colorIdx = (int) (conv.getId() % 5);

        return new ConversationResponse(
                String.valueOf(conv.getId()),
                displayName,
                initials,
                Boolean.TRUE.equals(conv.getIsGroup()),
                memberIds,
                conv.getLastMessageText() != null ? conv.getLastMessageText() : "",
                "text",
                time,
                conv.getUnreadCount() != null ? conv.getUnreadCount().intValue() : 0,
                online,
                Boolean.TRUE.equals(conv.getIsPinned()),
                colorIdx
        );
    }

    private Integer parseId(String idStr, String fieldName) {
        try {
            return Integer.parseInt(idStr);
        } catch (NumberFormatException e) {
            throw new RuntimeException(fieldName + " invalide.");
        }
    }

    private String computeInitials(String name) {
        if (name == null || name.isBlank()) return "??";
        String[] parts = name.trim().split("\\s+");
        if (parts.length == 1) {
            String w = parts[0];
            return (w.length() >= 2 ? w.substring(0, 2) : w).toUpperCase();
        }
        String first = String.valueOf(parts[0].charAt(0));
        String last = String.valueOf(parts[parts.length - 1].charAt(0));
        return (first + last).toUpperCase();
    }
}
