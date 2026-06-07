package com.photokeeper;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class PhotoKeeperApplication {

    private PhotoKeeperApplication() {}

    public static void main(String[] args) {
        SpringApplication.run(PhotoKeeperApplication.class, args);
    }
}
