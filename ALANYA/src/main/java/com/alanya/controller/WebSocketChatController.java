package com.alanya.controller;

import com.alanya.dto.request.TypingEvent;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

/**
 * Controleur STOMP : relaie les evenements temps reel (typing) vers les topics.
 */
@Controller
public class WebSocketChatController {

    /**
     * Le client envoie a /app/chats/{id}/typing avec un payload TypingEvent.
     * On rediffuse a /topic/chats/{id}/typing pour tous les abonnes de la conv.
     */
    @MessageMapping("/chats/{conversationId}/typing")
    @SendTo("/topic/chats/{conversationId}/typing")
    public TypingEvent broadcastTyping(
            @DestinationVariable String conversationId,
            @Payload TypingEvent event) {
        return event;
    }
}
