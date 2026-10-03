# Private road routing: never relies on a public demo routing API.
FROM ghcr.io/project-osrm/osrm-backend:v6.0.0@sha256:729461bcc9ae9e6aafa92c0f93db9b060a32e85d5e72092c01ae4a4a9f1eb564 AS builder
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pyosmium curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /maps
ARG OSM_DATA_URL=https://download.geofabrik.de/asia/gcc-states-260901.osm.pbf
RUN curl --fail --retry 3 -L "$OSM_DATA_URL" -o region.osm.pbf && curl --fail --retry 3 -L "$OSM_DATA_URL.md5" -o region.md5 && echo "$(cut -d' ' -f1 region.md5)  region.osm.pbf" | md5sum --check -
COPY build_places.py ./
RUN python3 build_places.py region.osm.pbf places.sqlite
RUN osrm-extract --threads 2 -p /opt/car.lua region.osm.pbf && osrm-partition --threads 2 region.osrm && osrm-customize --threads 2 region.osrm && rm region.osm.pbf region.md5
FROM ghcr.io/project-osrm/osrm-backend:v6.0.0@sha256:729461bcc9ae9e6aafa92c0f93db9b060a32e85d5e72092c01ae4a4a9f1eb564
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /maps/region.osrm* /maps/
COPY --from=builder /maps/places.sqlite /maps/places.sqlite
WORKDIR /app
COPY server.py ./
ENV PORT=8080 OSM_DATA_DATE=2026-09-01 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8080
USER 65534:65534
CMD ["python3", "server.py"]
