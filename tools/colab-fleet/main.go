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
		Short: "GNULense Colab Fleet Manager — 5 shards, stop-log, no overlap",
		Long: `Manages 5 Colab shards for GNULense crawler.
Each shard is hash(url)%TOTAL==SHARD_ID, checkpoints to Mongo shard_checkpoints.
Media -> GitHub CDN (GNULense-media), HTML -> Tigris (gnu-lens-raw), JSON -> Tigris (gnu-lens-processed).
Vercel Edge is the backend, Railway optional.`,
	}

	root.PersistentFlags().IntVar(&shards, "shards", 5, "number of shards (1-10)")
	root.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "print commands without running")

	deployCmd := &cobra.Command{
		Use:   "deploy",
		Short: "Deploy 5 colab notebooks (via colaho or manual hint)",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("GNULense fleet: %d shards\n", shards)
			fmt.Println("Tigris: gnu-lens-raw / gnu-lens-processed @ t3.storage.dev")
			fmt.Println("Mongo: gnu-lens-manifest")
			fmt.Println("Media CDN: abdou-da0wew/GNULense-media")
			fmt.Println("")

			// Check colaho
			if hasColaho() {
				fmt.Println("Found colaho — using it to deploy")
				for i := 0; i < shards; i++ {
					fmt.Printf("  shard %d: colaho deploy --count 1 (env CRAWL_SHARD_ID=%d)\n", i, i)
					if !dryRun {
						env := append(os.Environ(), fmt.Sprintf("CRAWL_SHARD_ID=%d", i), fmt.Sprintf("CRAWL_SHARD_TOTAL=%d", shards))
						c := exec.Command("colaho", "deploy", "--count", "1")
						c.Env = env
						c.Stdout = os.Stdout
						c.Stderr = os.Stderr
						if err := c.Run(); err != nil {
							fmt.Printf("shard %d deploy failed: %v (try manual colab)\n", i, err)
						}
					}
				}
				return nil
			}

			// Fallback: manual colab instructions
			fmt.Println("colaho not found — manual Colab fleet:")
			fmt.Println("  1. Open 5 Colab tabs")
			fmt.Println("  2. Each open colab/GNULense_Shard_{1..5}.ipynb")
			fmt.Println("  3. Set Secrets: MONGODB_URI, TIGRIS_*, GITHUB_TOKEN")
			fmt.Println("  4. Run all cells — each logs stop to shard_checkpoints")
			for i := 0; i < shards; i++ {
				fmt.Printf("  - Shard %d: colab/GNULense_Shard_%d.ipynb (SHARD_ID=%d)\n", i, i+1, i)
			}
			return nil
		},
	}

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show fleet status from Mongo shard_checkpoints",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Println("Checking Mongo shard_checkpoints...")
			c := exec.Command("mongosh", os.Getenv("MONGODB_URI"), "--eval", "db.shard_checkpoints.find().sort({stoppedAt:-1}).limit(5).toArray()")
			c.Stdout = os.Stdout
			c.Stderr = os.Stderr
			if err := c.Run(); err != nil {
				fmt.Println("mongosh not found — try: bun run validate:shards")
				exec.Command("bun", "run", "validate:shards").Run()
			}
			return nil
		},
	}

	logsCmd := &cobra.Command{
		Use:   "logs",
		Short: "Tail crawler logs (colaho logs if available)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if hasColaho() {
				c := exec.Command("colaho", "logs", "-f")
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				return c.Run()
			}
			fmt.Println("No colaho — check /tmp/crawl_*.log in each Colab")
			return nil
		},
	}

	newCmd := &cobra.Command{
		Use:   "new",
		Short: "Create a new Colab session and run crawler command",
		RunE: func(cmd *cobra.Command, args []string) error {
			shardID, _ := cmd.Flags().GetInt("shard")
			command := strings.Join(args, " ")
			if command == "" {
				command = "bun run crawl:shard"
			}
			fmt.Printf("New colab session: shard %d, cmd: %s\n", shardID, command)
			fmt.Println("This wraps 'colab new' + 'colab exec' if colab CLI is installed")
			if hasColab() {
				c := exec.Command("colab", "new", fmt.Sprintf("gnulense-shard-%d", shardID))
				c.Stdout = os.Stdout
				c.Stderr = os.Stderr
				if err := c.Run(); err != nil {
					return err
				}
				c2 := exec.Command("colab", "exec", fmt.Sprintf("gnulense-shard-%d", shardID), "--", command)
				c2.Stdout = os.Stdout
				c2.Stderr = os.Stderr
				return c2.Run()
			}
			fmt.Println("colab CLI not found — install 'pip install colab-cli' or use colaho")
			return nil
		},
	}
	newCmd.Flags().Int("shard", 0, "shard id")

	root.AddCommand(deployCmd, statusCmd, logsCmd, newCmd)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func hasColaho() bool {
	_, err := exec.LookPath("colaho")
	return err == nil
}

func hasColab() bool {
	_, err := exec.LookPath("colab")
	return err == nil
}
