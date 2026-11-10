# Private rehearsal channel (ADR-0001). Built only by the "Package rehearsal
# channel" workflow into its own private package; never part of the live image.
FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311

COPY nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx channel/ /srv/update/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
