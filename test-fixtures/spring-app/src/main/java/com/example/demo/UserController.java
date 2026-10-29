package com.example.demo;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping
    public List<User> list(
        @RequestParam(required = false)
        @Size(min = 2, max = 32)
        @Pattern(regexp = "[a-z]+")
        String role) {
        return List.of();
    }

    @GetMapping("/{id}")
    public User get(@PathVariable Long id) {
        return null;
    }

    @PostMapping
    public User create(@RequestBody User user) {
        return user;
    }

    @PutMapping("/{id}")
    public User update(@PathVariable Long id, @RequestBody User user) {
        return user;
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
    }
}
