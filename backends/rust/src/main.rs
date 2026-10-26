mod domain;
mod http;
mod store;

use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() {
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| ":memory:".into());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3006".into());
    let conn = store::open(&db_path).expect("open database");
    let db: http::Db = Arc::new(Mutex::new(conn));
    let app = axum::Router::new().fallback(http::handle).with_state(db);
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await.expect("bind");
    println!("team-notes (rust) listening on :{port}");
    axum::serve(listener, app).await.expect("serve");
}
