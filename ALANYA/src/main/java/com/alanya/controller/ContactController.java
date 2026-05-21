package com.alanya.controller;

import com.alanya.dto.request.AddContactRequest;
import com.alanya.dto.response.ContactResponse;
import com.alanya.security.CurrentUser;
import com.alanya.service.ContactService;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/contacts")
public class ContactController {

    @Autowired
    private ContactService contactService;

    /** GET /api/contacts — Liste des contacts de l'utilisateur. */
    @GetMapping
    public ResponseEntity<Map<String, List<ContactResponse>>> list() {
        List<ContactResponse> contacts = contactService.listContacts(CurrentUser.id());
        return ResponseEntity.ok(Map.of("contacts", contacts));
    }

    /** POST /api/contacts — Ajoute un contact par numero de telephone. */
    @PostMapping
    public ResponseEntity<Map<String, ContactResponse>> add(@Valid @RequestBody AddContactRequest request) {
        ContactResponse contact = contactService.addContact(CurrentUser.id(), request.getPhone());
        return ResponseEntity.status(201).body(Map.of("contact", contact));
    }

    /** DELETE /api/contacts/{friendId} — Retire un contact. */
    @DeleteMapping("/{friendId}")
    public ResponseEntity<Void> remove(@PathVariable Integer friendId) {
        contactService.removeContact(CurrentUser.id(), friendId);
        return ResponseEntity.noContent().build();
    }
}
