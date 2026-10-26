# Build with context at repo root: docker build -f backends/rust/Dockerfile .
FROM rust:1 AS build
WORKDIR /app/backends/rust
# Cache dependencies: build a stub crate first
COPY backends/rust/Cargo.toml backends/rust/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
# store.rs does include_str!("../../../spec/schema.sql")
COPY spec/ /app/spec/
COPY backends/rust/src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
COPY --from=build /app/backends/rust/target/release/team-notes-rust /usr/local/bin/server
ENV PORT=3000
EXPOSE 3000
CMD ["server"]
