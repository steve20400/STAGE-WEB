package com.alanya.service;

import com.alanya.dto.request.SendMessageRequest;
import com.alanya.dto.response.MessageResponse;
import com.alanya.model.Conversation;
import com.alanya.model.ConversationMember;
import com.alanya.model.Message;
import com.alanya.model.MessageRead;
import com.alanya.model.User;
import com.alanya.repository.ConversationMemberRepository;
import com.alanya.repository.ConversationRepository;
import com.alanya.repository.MessageReadRepository;
import com.alanya.repository.MessageRepository;
import com.alanya.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class MessageService {

    @Autowired
    private MessageRepository messageRepository;

    @Autowired
    private MessageReadRepository messageReadRepository;

    @Autowired
    private ConversationRepository conversationRepository;

    @Autowired
    private ConversationMemberRepository memberRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /** GET /chats/{id}/messages — liste les messages de la conversation. */
    public List<MessageResponse> listMessages(Integer userId, Long conversationId) {
        assertMember(userId, conversationId);

        List<Message> messages = messageRepository.findByConversationIdOrderBySendAtAsc(conversationId);

        // Pre-chargement des phones des senders (eviter N+1 queries)
        Map<Integer, String> phoneByUserId = preloadSenderPhones(messages);

        return messages.stream()
                .map(m -> toResponse(m, phoneByUserId.getOrDefault(m.getSenderId(), "")))
                .collect(Collectors.toList());
    }

    /** POST /chats/{id}/messages — envoie un message dans la conversation. */
    @Transactional
    public MessageResponse sendMessage(Integer userId, Long conversationId, SendMessageRequest request) {
        assertMember(userId, conversationId);

        Conversation conv = conversationRepository.findById(conversationId)
                .orElseThrow(() -> new RuntimeException("Conversation introuvable."));

        Message msg = new Message();
        msg.setConversationId(conversationId);
        msg.setSenderId(userId);
        msg.setContent(request.getContent().trim());
        msg.setType(typeStringToShort(request.getType()));
        msg.setStatus(false); // false = "sent" (non lu)
        msg.setSendAt(LocalDateTime.now());
        msg = messageRepository.save(msg);

        // Mise a jour denormalisee de la conversation
        conv.setLastMessageText(msg.getContent());
        conv.setLastMessageAt(msg.getSendAt());
        conversationRepository.save(conv);

        String senderPhone = userRepository.findById(userId)
                .map(User::getPhone)
                .orElse("");

        MessageResponse response = toResponse(msg, senderPhone);

        // Diffuse le nouveau message a tous les clients abonnes au topic de la conv
        messagingTemplate.convertAndSend("/topic/chats/" + conversationId, response);

        return response;
    }

    /**
     * Marque tous les messages non-lus de la conversation comme lus pour l'user.
     * Diffuse un evenement de statut a tous les abonnes pour qu'ils mettent a jour
     * leurs messages envoyes.
     */
    @Transactional
    public void markAsRead(Integer userId, Long conversationId) {
        assertMember(userId, conversationId);

        List<Message> readable = messageRepository.findByConversationIdOrderBySendAtAsc(conversationId).stream()
                .filter(m -> !m.getSenderId().equals(userId)) // on lit les messages des autres
                .filter(m -> !messageReadRepository.existsByMessageIdAndUserId(m.getId(), userId))
                .collect(Collectors.toList());

        if (readable.isEmpty()) return;

        LocalDateTime now = LocalDateTime.now();
        List<MessageRead> receipts = readable.stream().map(m -> {
            MessageRead receipt = new MessageRead();
            receipt.setMessageId(m.getId());
            receipt.setUserId(userId);
            receipt.setReadAt(now);
            return receipt;
        }).collect(Collectors.toList());
        messageReadRepository.saveAll(receipts);

        List<Integer> memberIds = memberRepository.findByConversationId(conversationId).stream()
                .map(ConversationMember::getUserId)
                .collect(Collectors.toList());

        List<Message> globallyRead = new ArrayList<>();
        for (Message message : readable) {
            List<Integer> recipients = memberIds.stream()
                    .filter(memberId -> !memberId.equals(message.getSenderId()))
                    .collect(Collectors.toList());
            long readCount = messageReadRepository.countByMessageIdAndUserIdIn(message.getId(), recipients);
            if (readCount == recipients.size()) {
                message.setStatus(true);
                globallyRead.add(message);
            }
        }

        if (globallyRead.isEmpty()) return;

        messageRepository.saveAll(globallyRead);

        String readerPhone = userRepository.findById(userId)
                .map(User::getPhone)
                .orElse("");

        // Notifie les autres clients du statut "lu" pour qu'ils mettent a jour leur UI
        messagingTemplate.convertAndSend(
                "/topic/chats/" + conversationId + "/status",
                Map.of("readBy", readerPhone, "messageIds",
                        globallyRead.stream().map(m -> String.valueOf(m.getId())).collect(Collectors.toList()))
        );
    }

    /* ----- Helpers ----- */

    private void assertMember(Integer userId, Long conversationId) {
        if (!conversationRepository.existsById(conversationId)) {
            throw new RuntimeException("Conversation introuvable.");
        }
        if (!memberRepository.existsByConversationIdAndUserId(conversationId, userId)) {
            throw new RuntimeException("Vous n'avez pas acces a cette conversation.");
        }
    }

    private Map<Integer, String> preloadSenderPhones(List<Message> messages) {
        Map<Integer, String> map = new HashMap<>();
        messages.stream()
                .map(Message::getSenderId)
                .distinct()
                .forEach(id -> userRepository.findById(id)
                        .ifPresent(u -> map.put(id, u.getPhone())));
        return map;
    }

    private MessageResponse toResponse(Message m, String senderPhone) {
        return new MessageResponse(
                String.valueOf(m.getId()),
                String.valueOf(m.getConversationId()),
                senderPhone,
                m.getContent(),
                typeShortToString(m.getType()),
                Boolean.TRUE.equals(m.getStatus()) ? "read" : "sent",
                m.getSendAt()
        );
    }

    private Short typeStringToShort(String type) {
        if (type == null) return 0;
        return switch (type.toLowerCase()) {
            case "image" -> (short) 1;
            case "audio" -> (short) 2;
            case "file"  -> (short) 3;
            default      -> (short) 0;  // text
        };
    }

    private String typeShortToString(Short type) {
        if (type == null) return "text";
        return switch (type.intValue()) {
            case 1 -> "image";
            case 2 -> "audio";
            case 3 -> "file";
            default -> "text";
        };
    }
}
