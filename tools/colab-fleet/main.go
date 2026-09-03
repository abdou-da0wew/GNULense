package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

var (
	shards int
	dryRun bool
)

func main() {
	root := &cobra.Command{
		Use:   "colab-fleet",
		Short: "GNULense Colab Fleet Manager — dad/kids cluster, 5 shards, mesh via cloudflared",
		Long: `Dad watches kids, kids fallback to each other, gossip via SSE over cloudflared tunnels.
Media -> GNULense-media (GitHub CDN), HTML -> t3 gnu-lens-raw, JSON -> gnu-lens-processed, Mongo -> gnu-lens-manifest.
Vercel Edge is backend, Railway optional. .sh scripts in scripts/cluster/ are uploaded and run on each colab.`,
	}
	root.PersistentFlags().IntVar(&shards, "shards", 5, "number of shards (1-10)")
	root.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "print without running")

	deployCmd := &cobra.Command{
		Use:   "deploy",
		Short: "Deploy classic 5 notebooks (colaho or manual)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return deployClassic()
		},
	}

	clusterCmd := &cobra.Command{
		Use:   "cluster",
		Short: "Deploy dad/kids mesh cluster (.sh + cloudflared + SSE gossip)",
	}
	clusterDeploy := &cobra.Command{
		Use:   "deploy",
		Short: "Upload .sh scripts and run dad then kids with tunnel mesh",
		RunE: func(cmd *cobra.Command, args []string) error {
			return deployCluster()
		},
	}
	clusterStatus := &cobra.Command{
		Use:   "status",
		Short: "Show mesh peers from dad tunnel",
		RunE: func(cmd *cobra.Command, args []string) error {
			dadURL := os.Getenv("DAD_URL")
			if dadURL == "" {
				fmt.Println("Set DAD_URL=https://xxx.trycloudflare.com to query")
				return nil
			}
			c := exec.Command("curl", "-sf", dadURL+"/peers")
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			return c.Run()
		},
	}
	clusterCmd.AddCommand(clusterDeploy, clusterStatus)

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show Mongo shard_checkpoints",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("Mongo shard_checkpoints (via bun):")
			c := exec.Command("bun", "run", "validate:shards")
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			return c.Run()
		},
	}
	logsCmd := &cobra.Command{
		Use:   "logs",
		Short: "Tail logs (colaho or /tmp)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if hasColaho() {
				c := exec.Command("colaho", "logs", "-f")
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				return c.Run()
			}
			fmt.Println("Check colab: /tmp/crawl-*.log, /tmp/gnulense-cluster.log, /tmp/cloudflared-*.log")
			return nil
		},
	}
	newCmd := &cobra.Command{
		Use:   "new",
		Short: "Create colab session and run command",
		RunE: func(cmd *cobra.Command, args []string) error {
			shardID, _ := cmd.Flags().GetInt("shard")
			command := strings.Join(args, " ")
			if command == "" {
				command = "bash scripts/cluster/dad.sh"
				if shardID != 0 {
					dadURL := os.Getenv("DAD_URL")
					command = fmt.Sprintf("DAD_URL=%s bash scripts/cluster/kid.sh", dadURL)
				}
			}
			fmt.Printf("colab new shard %d: %s\n", shardID, command)
			if hasColab() {
				c := exec.Command("colab", "new", fmt.Sprintf("gnulense-shard-%d", shardID))
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				if err := c.Run(); err != nil {
					return err
				}
				c2 := exec.Command("colab", "exec", fmt.Sprintf("gnulense-shard-%d", shardID), "--", "bash", "-lc", command)
				c2.Stdout = os.Stdout
				c2.Stderr = os.Stderr
				return c2.Run()
			}
			fmt.Println("colab CLI not found — use colaho or manual notebooks")
			return nil
		},
	}
	newCmd.Flags().Int("shard", 0, "shard id")

	root.AddCommand(deployCmd, clusterCmd, statusCmd, logsCmd, newCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func deployClassic() error {
	fmt.Printf("Classic fleet: %d shards\n", shards)
	fmt.Println("Tigris: gnu-lens-raw / gnu-lens-processed @ t3.storage.dev")
	fmt.Println("Mongo: gnu-lens-manifest")
	fmt.Println("Media CDN: abdou-da0wew/GNULense-media")
	if hasColaho() {
		fmt.Println("colaho found — deploying")
		for i := 0; i < shards; i++ {
			fmt.Printf("  shard %d: colaho deploy --count 1 CRAWL_SHARD_ID=%d\n", i, i)
			if !dryRun {
				env := append(os.Environ(), fmt.Sprintf("CRAWL_SHARD_ID=%d", i), fmt.Sprintf("CRAWL_SHARD_TOTAL=%d", shards))
				c := exec.Command("colaho", "deploy", "--count", "1")
				c.Env = env
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				if err := c.Run(); err != nil {
					fmt.Printf("shard %d failed: %v\n", i, err)
				}
			}
		}
		return nil
	}
	fmt.Println("colaho not found — open 5 Colabs with colab/GNULense_Shard_{1..5}.ipynb")
	for i := 0; i < shards; i++ {
		fmt.Printf("  shard %d: colab/GNULense_Shard_%d.ipynb SHARD_ID=%d\n", i, i+1, i)
	}
	return nil
}

func deployCluster() error {
	fmt.Printf("Cluster deploy: %d nodes (dad + %d kids), mesh via cloudflared + SSE\n", shards, shards-1)
	fmt.Println("Uploading scripts/cluster/*.sh + coord-server.ts to each colab then running...")
	fmt.Println(" Dad: bash scripts/cluster/dad.sh")
	fmt.Println(" Kids: DAD_URL=<dad-tunnel> bash scripts/cluster/kid.sh")
	fmt.Println("")
	if dryRun {
		fmt.Println("dry-run: would upload and run:")
		for i := 0; i < shards; i++ {
			role := "kid"
			if i == 0 {
				role = "dad"
			}
			fmt.Printf("  colab exec gnulense-shard-%d -- bash scripts/cluster/%s.sh (ROLE=%s SHARD=%d)\n", i, role, role, i)
		}
		return nil
	}
	// If colaho available, use it to push files
	if hasColaho() {
		fmt.Println("Using colaho to push cluster scripts...")
		// colaho deploy will clone repo, so scripts are already there
		for i := 0; i < shards; i++ {
			role := "kid"
			if i == 0 {
				role = "dad"
			}
			fmt.Printf("  starting %s shard %d\n", role, i)
			env := append(os.Environ(), fmt.Sprintf("CRAWL_SHARD_ID=%d", i), fmt.Sprintf("CRAWL_SHARD_TOTAL=%d", shards), fmt.Sprintf("ROLE=%s", role))
			c := exec.Command("colaho", "deploy", "--count", "1")
			c.Env = env
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			if err := c.Run(); err != nil {
				fmt.Printf("  %s %d failed: %v\n", role, i, err)
			}
		}
		fmt.Println("Cluster deployed via colaho — check 'colaho status' and dad tunnel /peers")
		return nil
	}
	if hasColab() {
		fmt.Println("Using colab CLI to upload and run...")
		for i := 0; i < shards; i++ {
			role := "kid"
			if i == 0 {
				role = "dad"
			}
			fmt.Printf("  colab new gnulense-shard-%d (%s)\n", i, role)
			exec.Command("colab", "new", fmt.Sprintf("gnulense-shard-%d", i)).Run()
			// upload scripts via colab exec cat >
			for _, f := range []string{"scripts/cluster/common.sh", "scripts/cluster/coord-server.ts", "scripts/cluster/node.sh", "scripts/cluster/dad.sh", "scripts/cluster/kid.sh"} {
				data, _ := os.ReadFile(f)
				cmd := fmt.Sprintf("mkdir -p $(dirname %s) && cat > %s <<'EOF'\n%s\nEOF", f, f, string(data))
				exec.Command("colab", "exec", fmt.Sprintf("gnulense-shard-%d", i), "--", "bash", "-lc", cmd).Run()
			}
			var runCmd string
			if i == 0 {
				runCmd = "bash scripts/cluster/dad.sh"
			} else {
				// need dad URL — try to fetch from dad's /tmp/gnulense-dad-url via colab exec
				dadURL := os.Getenv("DAD_URL")
				if dadURL == "" {
					// try to get from dad colab
					out, _ := exec.Command("colab", "exec", "gnulense-shard-0", "--", "cat", "/tmp/gnulense-dad-url").Output()
					dadURL = strings.TrimSpace(string(out))
				}
				runCmd = fmt.Sprintf("DAD_URL=%s bash scripts/cluster/kid.sh", dadURL)
			}
			fmt.Printf("  running %s on shard %d: %s\n", role, i, runCmd)
			c := exec.Command("colab", "exec", fmt.Sprintf("gnulense-shard-%d", i), "--", "bash", "-lc", runCmd)
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			c.Run()
		}
		return nil
	}
	fmt.Println("No colaho/colab CLI — manual cluster:")
	fmt.Println("  1. Dad colab: bash scripts/cluster/dad.sh (copy tunnel url)")
	fmt.Println("  2. Kids: DAD_URL=https://xxx.trycloudflare.com bash scripts/cluster/kid.sh (each)")
	fmt.Println("  Go manager will auto-upload .sh when colab CLI is available")
	return nil
}

func hasColaho() bool { _, err := exec.LookPath("colaho"); return err == nil }
func hasColab() bool  { _, err := exec.LookPath("colab"); return err == nil }
