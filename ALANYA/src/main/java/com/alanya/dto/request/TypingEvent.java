package com.alanya.dto.request;

/**
 * Payload des evenements "en train d'ecrire" diffuses via WebSocket.
 */
public class TypingEvent {
    private String phone;
    private Boolean isTyping;

    public TypingEvent() {}

    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public Boolean getIsTyping() { return isTyping; }
    public void setIsTyping(Boolean isTyping) { this.isTyping = isTyping; }
}
