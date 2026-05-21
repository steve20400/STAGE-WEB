package com.alanya.dto.response;

import java.time.LocalDateTime;

public class CallResponse {
    private String id;
    private String contactId;
    private String contactName;
    private String contactInitials;
    private String direction;   // "in" | "out" | "missed"
    private String type;        // "audio" | "video"
    private String status;      // "ended" | "declined" | "no_answer"
    private String duration;    // format "MM:SS"
    private LocalDateTime createdAt;
    private Boolean isGroup;

    public CallResponse() {}

    public CallResponse(String id, String contactId, String contactName, String contactInitials,
                        String direction, String type, String status, String duration,
                        LocalDateTime createdAt, Boolean isGroup) {
        this.id = id;
        this.contactId = contactId;
        this.contactName = contactName;
        this.contactInitials = contactInitials;
        this.direction = direction;
        this.type = type;
        this.status = status;
        this.duration = duration;
        this.createdAt = createdAt;
        this.isGroup = isGroup;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getContactId() { return contactId; }
    public void setContactId(String contactId) { this.contactId = contactId; }
    public String getContactName() { return contactName; }
    public void setContactName(String contactName) { this.contactName = contactName; }
    public String getContactInitials() { return contactInitials; }
    public void setContactInitials(String contactInitials) { this.contactInitials = contactInitials; }
    public String getDirection() { return direction; }
    public void setDirection(String direction) { this.direction = direction; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getDuration() { return duration; }
    public void setDuration(String duration) { this.duration = duration; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public Boolean getIsGroup() { return isGroup; }
    public void setIsGroup(Boolean isGroup) { this.isGroup = isGroup; }
}
