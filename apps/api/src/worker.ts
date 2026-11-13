const poll = setInterval(() => {}, 500);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => clearInterval(poll));
