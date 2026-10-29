package com.example.demo;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/files")
public class FileController {

    @PostMapping(path = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public String upload(
        @RequestParam("file") MultipartFile file,
        @RequestParam(value = "description", required = false) String description) {
        return "ok";
    }

    @PostMapping(path = "/form", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public String submitForm(@RequestParam("name") String name,
        @RequestParam(value = "age", required = false) Integer age) {
        return name;
    }

    @GetMapping("/meta")
    public String metadata(
        @RequestHeader("X-Request-Id") String requestId,
        @RequestParam(value = "verbose", required = false, defaultValue = "false") Boolean verbose) {
        return requestId;
    }
}
