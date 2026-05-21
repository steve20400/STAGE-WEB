package com.alanya.service;

import com.alanya.dto.response.ContactResponse;
import com.alanya.model.Contact;
import com.alanya.model.User;
import com.alanya.repository.ContactRepository;
import com.alanya.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class ContactService {

    @Autowired
    private ContactRepository contactRepository;

    @Autowired
    private UserRepository userRepository;

    /** Liste les contacts de l'utilisateur (preferred_contact). */
    public List<ContactResponse> listContacts(Integer userId) {
        return contactRepository.findByUserId(userId).stream()
                .map(c -> userRepository.findById(c.getFriendId()).orElse(null))
                .filter(u -> u != null)
                .map(this::toResponse)
                .collect(Collectors.toList());
    }

    /** Ajoute un contact par son numero de telephone. */
    public ContactResponse addContact(Integer userId, String phone) {
        User friend = userRepository.findByPhone(phone)
                .orElseThrow(() -> new RuntimeException("Aucun utilisateur trouve avec ce numero."));

        if (friend.getId().equals(userId)) {
            throw new RuntimeException("Vous ne pouvez pas vous ajouter vous-meme.");
        }

        if (contactRepository.findByUserIdAndFriendId(userId, friend.getId()).isPresent()) {
            throw new RuntimeException("Ce contact est deja dans votre liste.");
        }

        Contact contact = new Contact();
        contact.setUserId(userId);
        contact.setFriendId(friend.getId());
        contact.setCreatedAt(LocalDateTime.now());
        contactRepository.save(contact);

        return toResponse(friend);
    }

    /** Supprime un contact par l'id du friend. */
    @Transactional
    public void removeContact(Integer userId, Integer friendId) {
        if (contactRepository.findByUserIdAndFriendId(userId, friendId).isEmpty()) {
            throw new RuntimeException("Contact introuvable.");
        }
        contactRepository.deleteByUserIdAndFriendId(userId, friendId);
    }

    private ContactResponse toResponse(User user) {
        return new ContactResponse(
                String.valueOf(user.getId()),
                user.getName(),
                computeInitials(user.getName()),
                user.getEmail(),
                user.getPhone(),
                Boolean.TRUE.equals(user.getIsOnline())
        );
    }

    /**
     * "Kevin Manga"   → "KM"
     * "Kevin"         → "KE"
     * "  alice  bob " → "AB"
     */
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
