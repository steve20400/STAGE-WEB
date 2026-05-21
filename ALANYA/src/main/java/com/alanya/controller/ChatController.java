package com.alanya.controller;

import com.alanya.dto.request.CreateChatRequest;
import com.alanya.dto.request.SendMessageRequest;
import com.alanya.dto.response.ConversationResponse;
import com.alanya.dto.response.MessageResponse;
import com.alanya.security.CurrentUser;
import com.alanya.service.ConversationService;
import com.alanya.service.MessageService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/chats")
public class ChatController {

    @Autowired
    private ConversationService conversationService;

    @Autowired
    private MessageService messageService;

    /** GET /api/chats — liste des conversations de l'utilisateur. */
    @GetMapping
    public ResponseEntity<Map<String, List<ConversationResponse>>> list() {
        List<ConversationResponse> chats = conversationService.listConversations(CurrentUser.id());
        return ResponseEntity.ok(Map.of("conversations", chats));
    }

    /** POST /api/chats — cree une conversation privee ou un groupe. */
    @PostMapping
    public ResponseEntity<Map<String, ConversationResponse>> create(@Valid @RequestBody CreateChatRequest request) {
        ConversationResponse chat = conversationService.createConversation(CurrentUser.id(), request);
        return ResponseEntity.status(201).body(Map.of("conversation", chat));
    }

    /** GET /api/chats/{chatId}/messages — liste les messages d'une conversation. */
    @GetMapping("/{chatId}/messages")
    public ResponseEntity<Map<String, List<MessageResponse>>> listMessages(@PathVariable Long chatId) {
        List<MessageResponse> messages = messageService.listMessages(CurrentUser.id(), chatId);
        return ResponseEntity.ok(Map.of("messages", messages));
    }

    /** POST /api/chats/{chatId}/messages — envoie un message dans la conversation. */
    @PostMapping("/{chatId}/messages")
    public ResponseEntity<Map<String, MessageResponse>> sendMessage(
            @PathVariable Long chatId,
            @Valid @RequestBody SendMessageRequest request) {
        MessageResponse message = messageService.sendMessage(CurrentUser.id(), chatId, request);
        return ResponseEntity.status(201).body(Map.of("message", message));
    }

    /** POST /api/chats/{chatId}/read — marque tous les messages non-lus comme lus. */
    @PostMapping("/{chatId}/read")
    public ResponseEntity<Void> markRead(@PathVariable Long chatId) {
        messageService.markAsRead(CurrentUser.id(), chatId);
        return ResponseEntity.noContent().build();
    }
}
