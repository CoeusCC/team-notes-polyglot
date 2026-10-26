FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY backends/dotnet/NotesApi.csproj ./
RUN dotnet restore
COPY backends/dotnet/src ./src
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /out ./
COPY spec/schema.sql /app/spec/schema.sql
ENV PORT=3000 DB_PATH=:memory: SCHEMA_PATH=/app/spec/schema.sql ASPNETCORE_URLS=http://0.0.0.0:3000
EXPOSE 3000
ENTRYPOINT ["dotnet", "NotesApi.dll"]
