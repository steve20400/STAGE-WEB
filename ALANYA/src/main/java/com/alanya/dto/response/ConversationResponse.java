package com.alanya.dto.response;

import java.util.List;

public class ConversationResponse {
    private String id;
    private String name;
    private String initials;
    private Boolean isGroup;
    private List<String> members;
    private String lastMessage;
    private String lastMessageType;
    private String time;
    private Integer unread;
    private Boolean online;
    private Boolean isPinned;
    private Integer colorIdx;

    public ConversationResponse() {}

    public ConversationResponse(String id, String name, String initials, Boolean isGroup,
                                List<String> members, String lastMessage, String lastMessageType,
                                String time, Integer unread, Boolean online, Boolean isPinned, Integer colorIdx) {
        this.id = id;
        this.name = name;
        this.initials = initials;
        this.isGroup = isGroup;
        this.members = members;
        this.lastMessage = lastMessage;
        this.lastMessageType = lastMessageType;
        this.time = time;
        this.unread = unread;
        this.online = online;
        this.isPinned = isPinned;
        this.colorIdx = colorIdx;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getInitials() { return initials; }
    public void setInitials(String initials) { this.initials = initials; }
    public Boolean getIsGroup() { return isGroup; }
    public void setIsGroup(Boolean isGroup) { this.isGroup = isGroup; }
    public List<String> getMembers() { return members; }
    public void setMembers(List<String> members) { this.members = members; }
    public String getLastMessage() { return lastMessage; }
    public void setLastMessage(String lastMessage) { this.lastMessage = lastMessage; }
    public String getLastMessageType() { return lastMessageType; }
    public void setLastMessageType(String lastMessageType) { this.lastMessageType = lastMessageType; }
    public String getTime() { return time; }
    public void setTime(String time) { this.time = time; }
    public Integer getUnread() { return unread; }
    public void setUnread(Integer unread) { this.unread = unread; }
    public Boolean getOnline() { return online; }
    public void setOnline(Boolean online) { this.online = online; }
    public Boolean getIsPinned() { return isPinned; }
    public void setIsPinned(Boolean isPinned) { this.isPinned = isPinned; }
    public Integer getColorIdx() { return colorIdx; }
    public void setColorIdx(Integer colorIdx) { this.colorIdx = colorIdx; }
}
