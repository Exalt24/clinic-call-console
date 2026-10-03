# Two stages so the runtime image carries a JRE and a jar, not Maven and a ~/.m2 cache. Dependencies are resolved in their
# own layer first, so a source change does not re-download the world on every deploy.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
# The suite is the gate BEFORE the image is built (CI runs it), so the image build skips it to stay fast and deterministic.
RUN mvn -B -q clean package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Never run as root in a container that faces the internet.
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /build/target/*.jar app.jar
USER app

EXPOSE 8080

# Render supplies PORT; Spring reads server.port, so bridge the two instead of assuming 8080 survives.
# The prod profile has no default for any secret, so a missing variable stops the boot instead of falling back to a demo value.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75" SPRING_PROFILES_ACTIVE=prod
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/actuator/health" | grep -q UP || exit 1
CMD ["sh", "-c", "java -Dserver.port=${PORT:-8080} -jar app.jar"]
