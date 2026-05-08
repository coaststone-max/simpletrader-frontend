//+------------------------------------------------------------------+
//|  SimpleTrader Live EA — MetaTrader 4                            |
//|  Versión: 2.0.0                                                  |
//|  Conecta tu cuenta MT4 a https://simpletrader.app en tiempo real |
//+------------------------------------------------------------------+
//
//  INSTRUCCIONES DE INSTALACIÓN:
//  1. Copia este archivo a: <MT4_DATA_FOLDER>/MQL4/Experts/
//  2. En MetaTrader 4: Herramientas → Opciones → Asesores Expertos
//     → Activar "Permitir solicitudes WebRequest para las siguientes URL"
//     → Añadir URL: https://simpletrader.app
//  3. Reinicia MetaTrader 4
//  4. Abre un gráfico cualquiera (ej: EURUSD M1)
//  5. Arrastra el EA al gráfico, pega tu Token de conexión
//  6. Activa "Permitir trading en vivo" en la configuración del EA
//
//  Comandos soportados desde SimpleTrader:
//    close_all      — Cierra todas las posiciones abiertas
//    close_ticket   — Cierra una posición por ticket
//    close_profit   — Cierra todas las posiciones en beneficio
//    close_loss     — Cierra todas las posiciones en pérdida
//    open_order     — Abre una nueva posición
//    modify_sl_tp   — Modifica SL/TP de una posición
//
//+------------------------------------------------------------------+

#property copyright   "SimpleTrader App"
#property link        "https://simpletrader.app"
#property version     "2.00"
#property strict
#property description "Conecta tu cuenta MT4 a SimpleTrader en tiempo real."

//--- Parámetros de entrada
extern string InpToken     = "";     // 🔑 Token de conexión (obtén en simpletrader.app)
extern int    InpInterval  = 5;      // ⏱ Intervalo de actualización (segundos, mín. 3)
extern double InpMaxVolume = 10.0;   // 🛡 Volumen máximo por orden remota (seguridad)
extern bool   InpDebug     = false;  // 🐛 Mostrar logs detallados

//--- Constantes
string g_apiUrl = "https://simpletrader.app/api/mt5/tick";
#define ST_MAGIC 20250001

//+------------------------------------------------------------------+
int OnInit() {
  if (StringLen(StringTrimLeft(StringTrimRight(InpToken))) < 20) {
    MessageBox(
      "Token inválido o vacío.\n\nVe a simpletrader.app → Cuentas Live\n"
      "y genera un token de conexión.",
      "SimpleTrader EA",
      MB_ICONERROR
    );
    return INIT_PARAMETERS_INCORRECT;
  }
  EventSetTimer(MathMax(3, InpInterval));
  OnTimer();
  Print("✅ SimpleTrader MT4 EA v2.0 iniciado | Cuenta: #", AccountNumber());
  return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
  EventKillTimer();
  Comment("");
}

void OnTimer() { SendHeartbeat(); }

//+------------------------------------------------------------------+
void SendHeartbeat() {
  string acct = StringFormat(
    "{\"number\":\"%d\",\"broker\":\"%s\",\"server\":\"%s\",\"currency\":\"%s\","
    "\"leverage\":%d,\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,"
    "\"free_margin\":%.2f,\"margin_level\":%.2f,\"profit\":%.2f}",
    AccountNumber(),
    AccountCompany(), AccountServer(), AccountCurrency(),
    AccountLeverage(),
    AccountBalance(), AccountEquity(), AccountMargin(),
    AccountFreeMargin(),
    (AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100.0 : 0.0),
    AccountProfit()
  );

  string positions = "[";
  bool first = true;
  int total = OrdersTotal();
  for (int i = 0; i < total; i++) {
    if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
    if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
    if (!first) positions += ",";
    first = false;
    positions += StringFormat(
      "{\"ticket\":%d,\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%.2f,"
      "\"open_price\":%.5f,\"current_price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,"
      "\"profit\":%.2f,\"swap\":%.2f,\"open_time\":%d,\"magic\":%d}",
      OrderTicket(), OrderSymbol(),
      (OrderType() == OP_BUY ? "BUY" : "SELL"),
      OrderLots(), OrderOpenPrice(), OrderClosePrice(),
      OrderStopLoss(), OrderTakeProfit(),
      OrderProfit(), OrderSwap(),
      (int)OrderOpenTime(), OrderMagicNumber()
    );
  }
  positions += "]";

  string body = StringFormat(
    "{\"token\":\"%s\",\"platform\":\"MT4\",\"account\":%s,\"positions\":%s,\"timestamp\":%d}",
    InpToken, acct, positions, (int)TimeCurrent()
  );

  char  post[];
  char  result[];
  string headers = "";
  StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);

  ResetLastError();
  int httpCode = WebRequest(
    "POST", g_apiUrl,
    "Content-Type: application/json\r\n",
    NULL, 5000, post, 0, result, headers
  );

  if (httpCode == 200) {
    string resp = CharArrayToString(result);
    Comment("SimpleTrader: 🟢 ONLINE | " + AccountCompany() +
            " | Balance: " + DoubleToStr(AccountBalance(), 2) + " " + AccountCurrency() +
            " | Pos: " + IntegerToString(OrdersTotal()));
    if (InpDebug) Print("SimpleTrader resp: ", resp);

    if (StringFind(resp, "\"command\"") >= 0 &&
        StringFind(resp, "\"command\":null") < 0 &&
        StringFind(resp, "\"command\":\"\"")  < 0) {
      ProcessCommand(resp);
    }
  }
  else if (httpCode == -1) {
    int err = GetLastError();
    Comment("SimpleTrader: ⚠ Error de red (", err, ")");
    if (err == 5203 || err == 4051) {
      Print("❌ SimpleTrader: Añade https://simpletrader.app en Herramientas → Opciones → Asesores Expertos → WebRequest");
    }
  }
  else {
    Comment("SimpleTrader: HTTP ", httpCode);
  }
}

//+------------------------------------------------------------------+
// Simple JSON string extractor for MT4
string JsonGetString(string json, string key) {
  string search = "\"" + key + "\":\"";
  int pos = StringFind(json, search);
  if (pos < 0) return "";
  int start = pos + StringLen(search);
  int end   = StringFind(json, "\"", start);
  if (end < 0) return "";
  return StringSubstr(json, start, end - start);
}

double JsonGetDouble(string json, string key) {
  string search = "\"" + key + "\":";
  int pos = StringFind(json, search);
  if (pos < 0) return 0;
  string sub = StringSubstr(json, pos + StringLen(search), 30);
  return StringToDouble(sub);
}

int JsonGetInt(string json, string key) {
  return (int)JsonGetDouble(json, key);
}

//+------------------------------------------------------------------+
bool CloseOrderByTicket(int ticket) {
  if (!OrderSelect(ticket, SELECT_BY_TICKET)) return false;
  double price = (OrderType() == OP_BUY ? Bid : Ask);
  bool ok = OrderClose(ticket, OrderLots(), price, 20, clrNONE);
  if (!ok) Print("SimpleTrader: Error cerrando ticket ", ticket, ": ", GetLastError());
  return ok;
}

//+------------------------------------------------------------------+
void ProcessCommand(string response) {
  int cmdPos = StringFind(response, "\"command\":");
  if (cmdPos < 0) return;
  string cmdPart = StringSubstr(response, cmdPos + 10);

  Print("SimpleTrader: Ejecutando comando → ", StringSubstr(cmdPart, 0, 80));

  // ── close_all ──────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_all") >= 0) {
    int total = OrdersTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      double price = (OrderType() == OP_BUY ? Bid : Ask);
      if (OrderClose(OrderTicket(), OrderLots(), price, 20, clrNONE)) closed++;
    }
    Print("SimpleTrader ✅ close_all: ", closed, " posiciones cerradas.");
    return;
  }

  // ── close_profit ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_profit") >= 0) {
    int total = OrdersTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      if (OrderProfit() <= 0) continue;
      double price = (OrderType() == OP_BUY ? Bid : Ask);
      if (OrderClose(OrderTicket(), OrderLots(), price, 20, clrNONE)) closed++;
    }
    Print("SimpleTrader ✅ close_profit: ", closed, " posiciones en beneficio cerradas.");
    return;
  }

  // ── close_loss ─────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_loss") >= 0) {
    int total = OrdersTotal();
    int closed = 0;
    for (int i = total - 1; i >= 0; i--) {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      if (OrderProfit() >= 0) continue;
      double price = (OrderType() == OP_BUY ? Bid : Ask);
      if (OrderClose(OrderTicket(), OrderLots(), price, 20, clrNONE)) closed++;
    }
    Print("SimpleTrader ✅ close_loss: ", closed, " posiciones en pérdida cerradas.");
    return;
  }

  // ── close_ticket ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "close_ticket") >= 0) {
    int ticket = JsonGetInt(cmdPart, "ticket");
    if (ticket > 0) {
      if (CloseOrderByTicket(ticket))
        Print("SimpleTrader ✅ close_ticket: ticket ", ticket, " cerrado.");
    }
    return;
  }

  // ── modify_sl_tp ───────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "modify_sl_tp") >= 0) {
    int    ticket = JsonGetInt(cmdPart, "ticket");
    double sl     = JsonGetDouble(cmdPart, "sl");
    double tp     = JsonGetDouble(cmdPart, "tp");
    if (ticket > 0 && OrderSelect(ticket, SELECT_BY_TICKET)) {
      bool ok = OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE);
      if (ok) Print("SimpleTrader ✅ modify_sl_tp: ticket ", ticket, " SL=", sl, " TP=", tp);
      else    Print("SimpleTrader ❌ modify_sl_tp: error=", GetLastError());
    }
    return;
  }

  // ── open_order ─────────────────────────────────────────────────────────────
  if (StringFind(cmdPart, "open_order") >= 0) {
    string symbol     = JsonGetString(cmdPart, "symbol");
    string order_type = JsonGetString(cmdPart, "order_type");
    double volume     = JsonGetDouble(cmdPart, "volume");
    double sl         = JsonGetDouble(cmdPart, "sl");
    double tp         = JsonGetDouble(cmdPart, "tp");
    string comment    = JsonGetString(cmdPart, "comment");

    if (StringLen(symbol) < 3) { Print("SimpleTrader: open_order — símbolo inválido"); return; }
    if (volume <= 0 || volume > InpMaxVolume) {
      Print("SimpleTrader: open_order — volumen inválido o excede límite (", InpMaxVolume, "): ", volume);
      return;
    }

    int    cmd   = (order_type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);

    int ticket = OrderSend(
      symbol, cmd, volume, price, 20, sl, tp,
      StringLen(comment) > 0 ? comment : "SimpleTrader",
      ST_MAGIC, 0, clrNONE
    );
    if (ticket > 0)
      Print("SimpleTrader ✅ open_order: ", order_type, " ", volume, " ", symbol, " ticket=", ticket);
    else
      Print("SimpleTrader ❌ open_order: error=", GetLastError());
    return;
  }
}
