package com.alanya.dto.response;

public class ContactResponse {
    private String id;
    private String name;
    private String initials;
    private String email;
    private String phone;
    private Boolean online;

    public ContactResponse() {}

    public ContactResponse(String id, String name, String initials, String email, String phone, Boolean online) {
        this.id = id;
        this.name = name;
        this.initials = initials;
        this.email = email;
        this.phone = phone;
        this.online = online;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getInitials() { return initials; }
    public void setInitials(String initials) { this.initials = initials; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public Boolean getOnline() { return online; }
    public void setOnline(Boolean online) { this.online = online; }
}
