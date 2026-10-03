package dev.dacruz.clinic;

import dev.dacruz.clinic.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class ClinicCallConsoleApplication {

    public static void main(String[] args) {
        SpringApplication.run(ClinicCallConsoleApplication.class, args);
    }
}
