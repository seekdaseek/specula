# Security

Please report security problems privately, not in a public issue.

**Report:** open [@speculaDaBot](https://t.me/speculaDaBot) on Telegram and send `/support` followed by a description marked
"security". It is forwarded to the operator, who answers by hand.

Useful details: what you did, what you expected, what happened, and the affected command or endpoint. Please do not test against
other users' data, and do not run load tests against the hosted service.

Areas we care about most: one user seeing another user's programs or alerts, billing activation without a valid payment, the
webhook authentication, and secret handling. specula never holds a key for the payment recipient address and never logs the
Telegram token or the provider API key.

This is a small project without a bounty programme.
