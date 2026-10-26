# Build context: repository root.
FROM golang:1.23 AS build
WORKDIR /src
COPY backends/go/ /src/
COPY spec/schema.sql /src/schema.sql
RUN go mod tidy && go test ./... && CGO_ENABLED=0 go build -o /out/notes .

FROM gcr.io/distroless/static
COPY --from=build /out/notes /notes
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["/notes"]
