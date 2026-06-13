window.APP_CONFIG = {
  LOCAL_API_BASE: "http://localhost:8000",
  ONLINE_API_BASE: "https://kimmiii-resume-rewriter-api.ellolabs-projects.workers.dev",

  get API_BASE() {
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    return isLocal ? this.LOCAL_API_BASE : this.ONLINE_API_BASE;
  },

  get IS_LOCAL() {
    return this.API_BASE === this.LOCAL_API_BASE;
  },
};
