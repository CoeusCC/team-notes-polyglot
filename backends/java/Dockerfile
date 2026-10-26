FROM maven:3-eclipse-temurin-21 AS build
WORKDIR /build
COPY backends/java/pom.xml .
RUN mvn -q -B -DskipTests dependency:go-offline
COPY backends/java/src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/app.jar /app/app.jar
COPY spec/ /app/spec/
ENV PORT=3000 DB_PATH=:memory: SCHEMA_PATH=/app/spec/schema.sql
EXPOSE 3000
CMD ["java", "-jar", "/app/app.jar"]
