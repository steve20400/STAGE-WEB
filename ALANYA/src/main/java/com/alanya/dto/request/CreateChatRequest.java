package com.alanya.dto.request;

import java.util.List;

/**
 * Deux modes :
 *   - Prive : { "contactId": "1" }
 *   - Groupe : { "name": "Mon groupe", "memberIds": ["1","4","5"] }
 */
public class CreateChatRequest {
    private String contactId;
    private String name;
    private List<String> memberIds;

    public String getContactId() { return contactId; }
    public void setContactId(String contactId) { this.contactId = contactId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<String> getMemberIds() { return memberIds; }
    public void setMemberIds(List<String> memberIds) { this.memberIds = memberIds; }
}
